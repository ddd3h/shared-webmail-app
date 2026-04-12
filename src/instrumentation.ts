export async function register() {
  // Only load Node.js-specific code in the Node.js runtime (not Edge).
  // Next.js will not bundle instrumentation.node.ts for the Edge runtime.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node');
  }
}
