import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useUploadFile } from '@/features/files/hooks';
import type { FileRecord } from '@/features/files/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote } from '@/components/ui/misc';

function prettyBytes(n?: number) {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function StoragePage() {
  const upload = useUploadFile();
  // Uploads land in DMS; this list is just what this session put there.
  const [uploaded, setUploaded] = useState<FileRecord[]>([]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-sm text-muted-foreground">
          Pre-signed URL upload: presign → binary PUT to the provider → GetFile.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a file</CardTitle>
          <CardDescription>
            The PUT goes straight to the storage provider on a pre-authorized URL — no bearer token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/40">
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium">Choose a file</span>
            <span className="text-xs text-muted-foreground">
              {upload.isPending ? 'Uploading…' : 'Stored privately by default'}
            </span>
            <input
              type="file"
              className="hidden"
              disabled={upload.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                upload.mutate(file, {
                  onSuccess: (record) => setUploaded((prev) => [record, ...prev]),
                });
                e.target.value = '';
              }}
            />
          </label>

          {upload.isError && <ErrorNote error={upload.error} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploaded this session</CardTitle>
        </CardHeader>
        <CardContent>
          {uploaded.length === 0 ? (
            <EmptyState title="Nothing uploaded yet" description="Files you upload appear here." />
          ) : (
            <ul className="divide-y">
              {uploaded.map((f) => (
                <li key={f.fileId} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.name ?? f.fileId}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{f.fileId}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {prettyBytes(f.sizeInBytes)}
                    </span>
                    {f.url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={f.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
