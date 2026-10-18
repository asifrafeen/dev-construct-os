import { useMutation, useQueryClient } from '@tanstack/react-query';
import { files, type PresignInput } from './api';
import { BLOCKS } from '@/lib/env';
import { trackedFetch } from '@/lib/tracked-fetch';

/**
 * Headers for the PUT to the storage provider. The pre-signed URL is already authorized,
 * so it carries no Bearer token.
 *
 * DMS now says exactly which headers it requires (`requiredHeaders`), and those win. The
 * older guesses stay as a fallback for a server that does not send them: Azure Blob
 * demands `x-ms-blob-type: BlockBlob`, and other providers ignore the extra header, so
 * Azure is detected from the URL rather than per project.
 */
function providerHeaders(
  uploadUrl: string,
  contentType: string,
  required: Record<string, string> | undefined,
): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': contentType || 'application/octet-stream',
    'x-blocks-key': BLOCKS.projectKey,
  };
  if (/\.blob\.core\.windows\.net/i.test(uploadUrl)) h['x-ms-blob-type'] = 'BlockBlob';
  return { ...h, ...(required ?? {}) };
}

/** Presign → PUT → complete (when required) → GetFile, as one step. */
export async function uploadFile(file: File, opts: Omit<PresignInput, 'name'> = {}) {
  const presigned = await files.presign({
    name: file.name,
    sizeInBytes: file.size,
    contentType: file.type || undefined,
    ...opts,
  });
  const { uploadUrl, fileId } = presigned;
  if (!uploadUrl || !fileId) throw new Error('Presign returned no uploadUrl/fileId');

  const put = await trackedFetch(uploadUrl, {
    method: 'PUT',
    headers: providerHeaders(uploadUrl, file.type, presigned.requiredHeaders),
    body: file, // raw bytes
  });
  if (!put.ok) throw new Error(`Storage upload failed: ${put.status}`);

  // Some storage configurations keep the file invisible (and unverified) until DMS is
  // told the bytes arrived.
  if (presigned.uploadCompletionRequired && presigned.fileVersionId) {
    const done = await files.completeUpload(fileId, presigned.fileVersionId);
    if (done.isSuccess === false) {
      throw new Error(`Upload was rejected: ${done.rejectionReason ?? done.verificationStatus ?? 'unknown reason'}`);
    }
  }

  // GetFile confirms the upload landed and returns the download URL.
  return files.get(fileId);
}

export function useUploadFile(opts: Omit<PresignInput, 'name'> = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadFile(file, opts),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['storage'] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fileId, permanent = false }: { fileId: string; permanent?: boolean }) => files.del(fileId, permanent),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['files'] });
      void qc.invalidateQueries({ queryKey: ['storage'] });
    },
  });
}
