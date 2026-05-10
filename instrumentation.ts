export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBackgroundJobs } = await import('@/lib/background-jobs');
    startBackgroundJobs();
  }
}
