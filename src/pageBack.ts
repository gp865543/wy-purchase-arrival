import { onMounted, onUnmounted } from 'vue';

// Keep component pages in WebView history so the shell can go back without reloading.
const pages: { id: number; leave: () => void; canLeave: () => boolean; url: string }[] = [];
let nextId = 0;
const rootUrl = () => location.pathname + location.search;
history.replaceState({ ...history.state, materialPage: 0 }, '', rootUrl());
window.addEventListener('popstate', () => {
  const page = pages[pages.length - 1];
  const target = history.state?.materialPage ?? 0;
  if (target === page?.id) return;
  // Forward entries whose component was closed no longer contain live draft state.
  if (target && !pages.some(item => item.id === target)) {
    history.replaceState({ materialPage: page?.id ?? 0 }, '', page?.url ?? rootUrl());
    return;
  }
  const leaving = pages.filter(item => item.id > target);
  if (leaving.some(item => !item.canLeave())) {
    history.pushState({ materialPage: page!.id }, '', page!.url);
    return;
  }
  while (pages.length && pages[pages.length - 1].id > target) pages.pop()!.leave();
});

export function usePageBack(name: string, leave: () => void, canLeave = () => true) {
  const page = { id: ++nextId, leave, canLeave, url: `${rootUrl()}#${name}` };
  onMounted(() => {
    pages.push(page);
    history.pushState({ materialPage: page.id }, '', page.url);
  });
  onUnmounted(() => {
    const index = pages.indexOf(page);
    if (index !== -1) pages.splice(index, 1);
  });
  return () => { if (pages[pages.length - 1] === page && canLeave()) history.back(); };
}
