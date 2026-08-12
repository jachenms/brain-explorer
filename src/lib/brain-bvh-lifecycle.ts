export function ensureLifecycleResources<T>(
  resources: Iterable<T>,
  isReady: (resource: T) => boolean,
  setup: (resource: T) => void,
) {
  for (const resource of resources) {
    if (!isReady(resource)) setup(resource);
  }
}

export function cleanupLifecycleResources<T>(
  resources: Iterable<T>,
  cleanup: (resource: T) => void,
) {
  for (const resource of resources) cleanup(resource);
}
