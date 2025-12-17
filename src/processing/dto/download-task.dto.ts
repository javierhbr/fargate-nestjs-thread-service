import { z } from 'zod';

export const DownloadTaskMessageSchema = z.object({
  taskId: z.string().uuid(),
  jobId: z.string().uuid(),
  exportId: z.string(),
  downloadUrl: z.string().url(),
  fileName: z.string(),
  fileSize: z.number().optional(),
  checksum: z.string().optional(),
  outputKey: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type DownloadTaskMessageDto = z.infer<typeof DownloadTaskMessageSchema>;

export function validateDownloadTaskMessage(data: unknown): DownloadTaskMessageDto {
  return DownloadTaskMessageSchema.parse(data);
}
