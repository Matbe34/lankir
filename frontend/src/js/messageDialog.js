let currentResolve = null;

/** Shows a message dialog with title, message, and type icon. */
export function showMessage(message, title = 'Message', type = 'info') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('messageDialog');
        const titleEl = document.getElementById('messageDialogTitle');
        const contentEl = document.getElementById('messageDialogContent');
        const footer = document.getElementById('messageDialogFooter');
        const okBtn = document.getElementById('messageDialogOk');

        // Set title and content
        titleEl.textContent = title;
        contentEl.textContent = message;

        // Add icon based on type
        const iconMap = {
            'success': '✓',
            'error': '✗',
            'warning': '⚠',
            'info': 'ℹ'
        };

        const icon = iconMap[type] || iconMap['info'];
        titleEl.innerHTML = `<span class="message-icon message-icon-${type}">${icon}</span> ${title}`;

        // Style the content to be selectable
        contentEl.style.userSelect = 'text';
        contentEl.style.cursor = 'text';
        contentEl.style.whiteSpace = 'pre-wrap';
        contentEl.style.wordBreak = 'break-word';

        // Show only OK button
        footer.innerHTML = '<button id="messageDialogOk" class="btn btn-primary">OK</button>';
        const newOkBtn = document.getElementById('messageDialogOk');

        // Store resolve for later
        currentResolve = resolve;

        // Show dialog
        dialog.classList.remove('hidden');

        // Focus OK button
        setTimeout(() => newOkBtn.focus(), 100);

        // Handle OK button click
        newOkBtn.onclick = () => {
            closeMessageDialog();
            resolve();
        };
    });
}

/** Shows a confirmation dialog, returns true if confirmed. */
export function showConfirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('messageDialog');
        const titleEl = document.getElementById('messageDialogTitle');
        const contentEl = document.getElementById('messageDialogContent');
        const footer = document.getElementById('messageDialogFooter');

        // Set title and content
        titleEl.innerHTML = `<span class="message-icon message-icon-info">?</span> ${title}`;
        contentEl.textContent = message;

        // Style the content to be selectable
        contentEl.style.userSelect = 'text';
        contentEl.style.cursor = 'text';
        contentEl.style.whiteSpace = 'pre-wrap';
        contentEl.style.wordBreak = 'break-word';

        // Show Yes/No buttons
        footer.innerHTML = `
            <button id="messageDialogNo" class="btn">No</button>
            <button id="messageDialogYes" class="btn btn-primary">Yes</button>
        `;

        const yesBtn = document.getElementById('messageDialogYes');
        const noBtn = document.getElementById('messageDialogNo');

        // Store resolve for later
        currentResolve = resolve;

        // Show dialog
        dialog.classList.remove('hidden');

        // Focus Yes button
        setTimeout(() => yesBtn.focus(), 100);

        // Handle button clicks
        yesBtn.onclick = () => {
            closeMessageDialog();
            resolve(true);
        };

        noBtn.onclick = () => {
            closeMessageDialog();
            resolve(false);
        };
    });
}

/** Closes the message dialog. */
function closeMessageDialog() {
    const dialog = document.getElementById('messageDialog');
    dialog.classList.add('hidden');

    if (currentResolve) {
        currentResolve = null;
    }
}

/** Initializes message dialog event handlers. */
export function initMessageDialog() {
    const dialog = document.getElementById('messageDialog');
    const closeBtn = document.getElementById('messageDialogClose');

    // Handle close button
    closeBtn.onclick = () => {
        closeMessageDialog();
        if (currentResolve) {
            currentResolve(false); // Treat close as cancel/no
        }
    };

    // Handle escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dialog.classList.contains('hidden')) {
            closeMessageDialog();
            if (currentResolve) {
                currentResolve(false); // Treat escape as cancel/no
            }
        }
    });

    // Handle click outside dialog
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            closeMessageDialog();
            if (currentResolve) {
                currentResolve(false); // Treat outside click as cancel/no
            }
        }
    });
}
