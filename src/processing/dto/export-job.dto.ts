import { z } from 'zod';

export const ExportJobMessageSchema = z.object({
  jobId: z.string().uuid(),
  exportId: z.string(),
  userId: z.string(),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
  taskToken: z.string().optional(), // Step Functions task token for callbacks
});

export type ExportJobMessageDto = z.infer<typeof ExportJobMessageSchema>;

export function validateExportJobMessage(data: unknown): ExportJobMessageDto {
  return ExportJobMessageSchema.parse(data);
}
