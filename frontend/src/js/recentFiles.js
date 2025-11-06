// Recent Files Module
// Handles loading and displaying recent files

import { openRecentFile } from './pdfOperations.js';

/**
 * Load and display recent files on welcome screen
 */
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
        
        recentGrid.innerHTML = '';
        recentFiles.slice(0, 6).forEach(file => {  // Show max 6 recent files
            const card = document.createElement('div');
            card.className = 'recent-file-card';
            card.innerHTML = `
                <span class="file-icon">📄</span>
                <div class="file-name" title="${file.filePath}">${file.fileName}</div>
                <div class="file-info">${file.pageCount} pages</div>
            `;
            card.addEventListener('click', async () => {
                await openRecentFile(file.filePath);
            });
            recentGrid.appendChild(card);
        });
        
    } catch (error) {
        console.error('Error loading recent files for welcome:', error);
    }
}
