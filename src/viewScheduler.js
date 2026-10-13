// Give the browser a paint opportunity before preparing a newly opened view.
// A newer navigation always supersedes queued work for an older view.
export function createViewScheduler({
  requestFrame = (callback) => requestAnimationFrame(callback),
  scheduleTask = (callback) => setTimeout(callback, 0),
} = {}) {
  let generation = 0;
  return {
    cancel() { generation += 1; },
    schedule(callback) {
      const token = ++generation;
      requestFrame(() => scheduleTask(() => {
        if (token === generation) callback();
      }));
    },
  };
}
