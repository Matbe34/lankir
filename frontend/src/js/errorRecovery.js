// Errors in words people use: what failed in the title, why in plain words,
// and the raw error text kept under "Details" for anyone who needs it.
import { showDialog } from './messageDialog.js';

const REASONS = [
    [/permission denied|EACCES|access is denied|operation not permitted/i, 'You don’t have permission to read this file.'],
    [/no such file|ENOENT|cannot find the file|does not exist|MissingPDF/i, 'The file isn’t there any more. It may have been moved, renamed or deleted.'],
    [/is a directory|not a regular file/i, 'That’s a folder or a special file, not a PDF.'],
    [/too large/i, 'The file is too large to open.'],
    [/InvalidPDF|Invalid PDF|not a PDF|bad XRef|startxref|malformed|corrupt/i, 'The file is damaged or isn’t a PDF.'],
    [/read-only|EROFS/i, 'The file is read-only.'],
    [/no space left|ENOSPC/i, 'There’s no space left on the disk.']
];

/** The error's own text: its message, or the error itself when it is a string. */
export function errorText(error) {
    if (typeof error === 'string') return error;
    return error?.message || String(error ?? 'Unknown error');
}

/** A plain-words reason for a known error, or null. */
export function plainReason(error) {
    const text = `${error?.name ?? ''} ${errorText(error)}`;
    return REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const baseName = (path) => path.split(/[/\\]/).pop();

/** The file a Go error names ("open /x/a.pdf: …", "stat /x/a.pdf: …"), or null. */
function fileNamed(error) {
    const match = /\b(?:open|stat|lstat|read)\s+(.+?\.pdf):\s/i.exec(errorText(error));
    return match ? baseName(match[1]) : null;
}

/**
 * Tells the user a PDF could not be opened. path (when known) names the file;
 * onChooseAnother adds "Choose another file…", which calls it.
 */
export async function showOpenError(error, { path, onChooseAnother } = {}) {
    const name = (path && baseName(path)) || fileNamed(error);
    // Choosing another file is the way forward, so it is the confirm; OK only closes.
    const actions = onChooseAnother
        ? [{ label: 'OK', value: 'ok' }, { label: 'Choose another file…', value: 'choose', kind: 'primary' }]
        : [{ label: 'OK', value: 'ok', kind: 'primary' }];
    const choice = await showDialog({
        tone: 'error',
        title: name ? `Lankir couldn’t open “${name}”` : 'Lankir couldn’t open the file',
        message: plainReason(error) ?? 'Something went wrong while reading the file.',
        details: errorText(error),
        actions,
        dismissValue: 'ok'
    });
    if (choice === 'choose') onChooseAnother();
}
