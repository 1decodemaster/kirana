export interface JobsWorker {
  stop(): void;
}

export function startJobsWorker(logger: { info: (msg: string) => void }, intervalMs = 60_000): JobsWorker {
  logger.info('jobs worker started (P6 stub)');
  const timer = setInterval(() => {
    logger.info('no jobs');
  }, intervalMs);
  timer.unref();
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
