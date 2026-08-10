import { BLOCKS, DATA_BASE } from '@/lib/env';
import { blocksFetch } from '@/lib/blocks-client';

/**
 * DMS / file storage.
 *
 * Uploads are two steps — presign, then a binary PUT straight to the storage provider.
 * There is no `/Files/UploadFile`. `/Files/*` routes are PascalCase and their responses
 * are flat (no `{ isSuccess, data, errors }` envelope).
 */

export interface PresignResponse {
  uploadUrl?: string;
  fileId?: string;
}

export interface FileRecord {
  fileId?: string;
  name?: string;
  url?: string;
  sizeInBytes?: number;
  currentVersion?: number;
}

export const files = {
  presign: (
    name: string,
    accessModifier: 'Public' | 'Private' = 'Private',
    configurationName = 'Default',
  ) =>
    blocksFetch<PresignResponse>(`${DATA_BASE}/Files/GetPreSignedUrlForUpload`, {
      method: 'POST',
      // moduleName must be an int; parentDirectoryId must be a string ("" = root), never null.
      body: {
        name,
        projectKey: BLOCKS.projectKey,
        accessModifier,
        configurationName,
        moduleName: 3,
        parentDirectoryId: '',
        tags: '',
        metaData: '{}',
      },
    }),

  get: (fileId: string, configurationName = 'Default') =>
    blocksFetch<FileRecord>(
      `${DATA_BASE}/Files/GetFile?FileId=${encodeURIComponent(fileId)}&ConfigurationName=${configurationName}`,
    ),

  getMany: (fileIds: string[], configurationName = 'Default') =>
    blocksFetch<FileRecord[]>(`${DATA_BASE}/Files/GetFiles`, {
      method: 'POST',
      body: { fileIds, configurationName },
    }),

  del: (fileId: string) =>
    blocksFetch<{ isSuccess?: boolean }>(`${DATA_BASE}/Files/DeleteFile`, {
      method: 'POST',
      body: { fileId, projectKey: BLOCKS.projectKey },
    }),
};
