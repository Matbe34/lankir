import { openRecentFile } from './pdfOperations.js';
import { escapeHtml } from './utils.js';

/** Loads and displays recent files on the welcome screen. */
export async function loadRecentFilesWelcome() {
    try {
        const recentFiles = await window.go.pdf.RecentFilesService.GetRecent();
        const recentGrid = document.getElementById('recentFilesGrid');
        
        if (!recentGrid) {
            return;
        }
        
        if (!recentFiles || recentFiles.length === 0) {
            recentGrid.innerHTML = '<div class="empty-state"><p>No recent files</p></div>';
            return;
        }
        
        // Get max items from settings
        const settings = JSON.parse(localStorage.getItem('pdfEditorSettings') || '{}');
        const maxItems = settings.recentFilesLength || 5;
        
        recentGrid.innerHTML = '';
        recentFiles.slice(0, maxItems).forEach(file => {
            const card = document.createElement('div');
            card.className = 'recent-file-card';
            card.innerHTML = `
                <button class="recent-file-remove" title="Remove from recent files">&times;</button>
                <div class="file-thumbnail-container">
                    <div class="file-thumbnail-loading">Loading...</div>
                </div>
                <div class="recent-file-info">
                    <div class="file-name" title="${escapeHtml(file.filePath)}">${escapeHtml(file.fileName)}</div>
                    <div class="file-info">${file.pageCount} pages</div>
                </div>
            `;
            
            // Load thumbnail asynchronously
            loadThumbnail(file.filePath, card);
            
            // Open file on card click
            card.addEventListener('click', async (e) => {
                // Don't open if clicking remove button
                if (e.target.classList.contains('recent-file-remove')) {
                    return;
                }
                await openRecentFile(file.filePath);
            });
            
            // Remove file from recent list
            const removeBtn = card.querySelector('.recent-file-remove');
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await removeRecentFile(file.filePath);
            });
            
            recentGrid.appendChild(card);
        });
        
    } catch (error) {
        console.error('Error loading recent files for welcome:', error);
        const recentGrid = document.getElementById('recentFilesGrid');
        if (recentGrid) {
            recentGrid.innerHTML = '<div class="empty-state"><p>Failed to load recent files</p></div>';
        }
    }
}

/** Loads a thumbnail image for a recent file card. */
async function loadThumbnail(filePath, card) {
    try {
        const thumbnailContainer = card.querySelector('.file-thumbnail-container');
        const loadingIndicator = card.querySelector('.file-thumbnail-loading');
        
        const thumbnailData = await window.go.pdf.PDFService.GenerateThumbnail(filePath, 400);
        
        const img = document.createElement('img');
        img.className = 'file-thumbnail';
        img.src = thumbnailData;
        img.alt = 'PDF Preview';
        
        loadingIndicator.remove();
        thumbnailContainer.appendChild(img);
    } catch (error) {
        console.error('Error loading thumbnail:', error);
        const thumbnailContainer = card.querySelector('.file-thumbnail-container');
        thumbnailContainer.innerHTML = '<span class="file-icon">📄</span>';
    }
}

/** Removes a file from the recent files list. */
async function removeRecentFile(filePath) {
    try {
        await window.go.pdf.RecentFilesService.RemoveRecent(filePath);
        // Reload the recent files display
        await loadRecentFilesWelcome();
    } catch (error) {
        console.error('Error removing recent file:', error);
    }
}
