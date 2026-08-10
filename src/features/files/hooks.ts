import { useMutation, useQueryClient } from '@tanstack/react-query';
import { files } from './api';
import { BLOCKS } from '@/lib/env';

/**
 * The pre-signed URL is already authorized, so the PUT carries no Bearer token.
 * Azure Blob additionally demands `x-ms-blob-type: BlockBlob`; other providers ignore
 * the extra header, so detect Azure from the URL rather than guessing per project.
 */
function providerHeaders(uploadUrl: string, contentType: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': contentType || 'application/octet-stream',
    'x-blocks-key': BLOCKS.projectKey,
  };
  if (/\.blob\.core\.windows\.net/i.test(uploadUrl)) h['x-ms-blob-type'] = 'BlockBlob';
  return h;
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { uploadUrl, fileId } = await files.presign(file.name);
      if (!uploadUrl || !fileId) throw new Error('Presign returned no uploadUrl/fileId');

      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: providerHeaders(uploadUrl, file.type),
        body: file, // raw bytes
      });
      if (!put.ok) throw new Error(`Storage upload failed: ${put.status}`);

      // GetFile confirms the upload landed and returns the download URL.
      return files.get(fileId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => files.del(fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  });
}
