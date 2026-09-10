export function isWorkerAuthorized(
  request: Request,
  workerSecret: string | undefined,
): boolean {
  return Boolean(
    workerSecret && request.headers.get("x-worker-secret") === workerSecret,
  );
}
