// A quiet progress line under the header while a document opens or saves.
// Several jobs can overlap; the line shows while any is running, and screen
// readers hear the latest job's message.
const jobs = new Set();
let bar = null;

/** Creates the progress line; call once at startup. */
export function initLoadingIndicator() {
    if (bar?.isConnected) return;
    bar = document.createElement('div');
    bar.id = 'loadingBar';
    bar.className = 'progress-line hidden';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Working');
    (document.getElementById('workspace') ?? document.body).append(bar);
}

function update() {
    if (!bar?.isConnected) initLoadingIndicator();
    const latest = [...jobs].at(-1);
    bar.classList.toggle('hidden', !latest);
    bar.setAttribute('aria-label', latest?.message ?? 'Working');
    document.getElementById('app')?.setAttribute('aria-busy', String(Boolean(latest)));
}

/** Shows the progress line for a job; returns the function that ends it (safe to call twice). */
export function showLoading(message = 'Working') {
    const job = { message };
    jobs.add(job);
    update();
    return () => {
        if (jobs.delete(job)) update();
    };
}
