/**
 * Generates and displays a QR code for the current page's URL.
 * @param {string} elementId The ID of the HTML element to render the QR code in.
 * @param {string} ip The IP address to use in the QR code URL.
 */
export function displayQRCode(elementId, ip) {
  const container = document.getElementById(elementId);
  if (!container) {
    console.error(`QR Code container with id #${elementId} not found.`);
    return;
  }

  const url = `http://${ip}:${window.location.port}`;

  QRCode.toCanvas(url, { width: 150, margin: 1 }, (err, canvas) => {
    if (err) return console.error(err);
    container.innerHTML = ''; // Clear previous QR code
    container.appendChild(canvas);
  });
}

/**
 * Shows a toast notification for an incoming file transfer.
 * @param {object} sender The user object of the sender.
 * @param {object} fileMetadata Metadata of the incoming file.
 * @param {function} callback A function to call with the user's choice (true for accept, false for reject).
 */
export function showIncomingFileToast(sender, fileMetadata, callback) {
    const container = document.getElementById('in-app-notification-container');
    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.innerHTML = `
        <div class="toast-header">
            <span>Incoming File from ${sender.name}</span>
            <button class="close-btn">&times;</button>
        </div>
        <div class="toast-body">
            <p><strong>File:</strong> ${fileMetadata.name}</p>
            <p><strong>Size:</strong> ${(fileMetadata.size / 1024 / 1024).toFixed(2)} MB</p>
            <div class="toast-actions">
                <button class="btn btn-accept">Accept</button>
                <button class="btn btn-reject">Reject</button>
            </div>
        </div>
    `;

    const close = () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('.close-btn').onclick = () => { close(); callback(false); };
    toast.querySelector('.btn-accept').onclick = () => { close(); callback(true); };
    toast.querySelector('.btn-reject').onclick = () => { close(); callback(false); };

    container.appendChild(toast);

    // Auto-reject after some time
    setTimeout(() => {
        if (container.contains(toast)) {
            close();
            callback(false);
        }
    }, 10000);
}

/**
 * Creates or updates a progress bar for a file transfer.
 * @param {string} peerId The ID of the peer (sender or receiver).
 * @param {string} fileName The name of the file.
 * @param {number} transferredSize The amount of data transferred so far.
 * @param {number} totalSize The total size of the file.
 * @param {boolean} [isSending=false] True if this is an outgoing file, false for incoming.
 * @param {number} [speed=0] The current transfer speed in bytes per second.
 * @param {string} [statusText=''] A status message to display when speed is not available.
 */
export function updateFileProgress(peerId, fileName, transferredSize, totalSize, isSending = false, speed = 0, statusText = '') {
    const progressId = `progress-${peerId}-${fileName.replace(/\W/g, '_')}`;
    let progressWrapper = document.getElementById(progressId);

    if (!progressWrapper) {
        progressWrapper = document.createElement('div');
        progressWrapper.id = progressId;
        progressWrapper.className = 'file-progress-wrapper';
        const peerNode = document.querySelector(`[data-peer-id="${peerId}"]`);
        if (peerNode) {
            peerNode.appendChild(progressWrapper);
        } else if (isSending) {
            // For sender, append to a general area if peer node isn't right
            document.getElementById('self-info').appendChild(progressWrapper);
        }
    }

    const percentage = totalSize > 0 ? Math.round((transferredSize / totalSize) * 100) : 100;
    const speedMbps = (speed * 8 / 1024 / 1024).toFixed(2); // Convert B/s to Mbps
    let speedDisplay = '';
    if (speed > 0) {
        speedDisplay = `${speedMbps} Mbps`;
    } else if (statusText) {
        speedDisplay = statusText;
    }

    progressWrapper.innerHTML = `
        <div class="file-progress-label">
            <span>${isSending ? 'Sending' : 'Receiving'} ${fileName}</span>
            <span class="file-progress-speed">${speedDisplay}</span>
        </div>
        <div class="file-progress-bar-container">
            <div class="file-progress-bar" style="width: ${percentage}%;"></div>
        </div>
        <div class="file-progress-percentage">${percentage}%</div>
    `;

    if (transferredSize >= totalSize) {
        // Keep the final state for a moment before removing
        progressWrapper.querySelector('.file-progress-speed').textContent = 'Complete!';
        setTimeout(() => progressWrapper.remove(), 3000);
    }
}

/**
 * Shows a general-purpose notification toast.
 * @param {string} message The message to display.
 * @param {'info'|'error'|'success'} type The type of notification, for styling.
 * @param {number} duration The duration in milliseconds to show the notification.
 */
export function showNotification(message, type = 'info', duration = 5000) {
    const container = document.getElementById('in-app-notification-container');
    const notification = document.createElement('div');
    // Use the existing 'toast' class for base styling and add a modifier for type
    notification.className = `toast show notification-${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, duration);
}
