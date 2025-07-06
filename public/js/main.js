import { showIncomingFileToast, updateFileProgress, displayQRCode, showNotification } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    const peersContainer = document.getElementById('peers-container');
    const selfInfoContainer = document.getElementById('self-info');
    const peerTemplate = document.getElementById('peer-template');

    let selfId = null;
    const peers = new Map();
    const peerConnections = new Map();
    const fileToSend = new Map(); // Tracks outgoing files for WebRTC
    const transferProgress = new Map(); // Tracks transfer speed
    const incomingWsFiles = new Map(); // Tracks incoming files for WebSocket fallback

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    ws.onopen = () => console.log('Connected to the signaling server');

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        // The console.log for every message can be noisy, especially with file chunks.
        // We'll log selectively inside the handlers instead.

        switch (message.type) {
            case 'welcome':
                selfId = message.user.id;
                selfInfoContainer.textContent = `You are: ${message.user.name}`;
                displayQRCode('qr-code-container', message.serverIp);
                message.allUsers.forEach(user => user.id !== selfId && addPeer(user));
                break;
            case 'user-joined':
                if (message.user.id !== selfId) addPeer(message.user);
                break;
            case 'user-left':
                removePeer(message.id);
                break;
            case 'offer':
                handleOffer(message.from, message.offer);
                break;
            case 'answer':
                handleAnswer(message.from, message.answer);
                break;
            case 'candidate':
                handleCandidate(message.from, message.candidate);
                break;
            // WebSocket fallback handshake
            case 'ws-file-accept':
                handleWsFileAccept(message.from);
                break;
            case 'ws-file-reject':
                handleWsFileReject(message.from);
                break;
            // WebSocket fallback cases
            case 'ws-file-start':
                handleWsFileStart(message.from, message.metadata);
                break;
            case 'ws-file-chunk':
                handleWsFileChunk(message.from, message.chunk);
                break;
            case 'ws-file-end':
                handleWsFileEnd(message.from);
                break;
        }
    };

    ws.onclose = () => {
        selfInfoContainer.textContent = 'Connection lost. Please refresh.';
        peersContainer.innerHTML = '';
    };

    ws.onerror = (error) => console.error('WebSocket error:', error);

    function sendMessage(to, message) {
        message.to = to;
        ws.send(JSON.stringify(message));
    }

    async function createPeerConnection(peerId) {
        // We provide multiple STUN and TURN server URLs to increase the chance of bypassing firewalls.
        // For a production app, you should deploy your own servers.
        const iceServers = [
            {
                urls: 'stun:stun.l.google.com:19302'
            },
            {
                // Using a public TURN server with multiple transport options for robustness.
                // `turns:` over TCP/443 has the highest chance of traversing restrictive firewalls.
                // For production, deploy your own TURN server.
                urls: [
                    'turn:numb.viagenie.ca?transport=udp',
                    'turns:numb.viagenie.ca:443?transport=tcp'
                ],
                username: 'webrtc@live.com',
                credential: 'muazkh'
            }
        ];
        const peerConnection = new RTCPeerConnection({ iceServers });

        peerConnection.oniceconnectionstatechange = async () => {
            console.log(`ICE connection state for peer ${peerId}: %c${peerConnection.iceConnectionState}`, 'font-weight: bold');

            if (peerConnection.iceConnectionState === 'failed') {
                // WebRTC failed, let's try the WebSocket fallback if we were the sender.
                if (fileToSend.has(peerId)) {
                    showNotification('WebRTC failed. Attempting to send file via server relay...', 'info');
                    const { file } = fileToSend.get(peerId);
                    sendFileViaWebSocket(peerId, file);
                }
                showNotification('Connection failed. The network may be blocking the connection or the public TURN server is offline.', 'error');
                console.error(`ICE connection failed for peer ${peerId}. Dumping candidate pair stats:`);
                const stats = await peerConnection.getStats();
                for (const stat of stats.values()) {
                    if (stat.type === 'candidate-pair') {
                        console.log(stat);
                    }
                }
            } else if (peerConnection.iceConnectionState === 'connected') {
                showNotification(`Connection to ${peers.get(peerId)?.user.name || 'peer'} established.`, 'success', 3000);
                const stats = await peerConnection.getStats();
                for (const stat of stats.values()) {
                    if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
                        const remoteCandidate = stats.get(stat.remoteCandidateId);
                        if (remoteCandidate && remoteCandidate.candidateType === 'relay') {
                            console.log(`%cConnection to ${peerId} is using a TURN relay server.`, 'color: orange; font-weight: bold;');
                            showNotification(`Connection is relayed through a TURN server.`, 'info', 4000);
                        }
                        break;
                    }
                }
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendMessage(peerId, { type: 'candidate', candidate: event.candidate });
            }
        };

        peerConnection.ondatachannel = (event) => {
            const receiveChannel = event.channel;
            let receivedBuffers = [];
            let fileMetadata = {};

            receiveChannel.onmessage = (event) => {
                if (typeof event.data === 'string') {
                    fileMetadata = JSON.parse(event.data);
                    const progressId = `webrtc-recv-${peerId}-${fileMetadata.name}`;
                    transferProgress.set(progressId, { lastSize: 0, lastTime: Date.now(), lastSpeed: 0 });
                    showIncomingFileToast(peers.get(peerId).user, fileMetadata, (accept) => {
                        if (!accept) {
                            updateFileProgress(peerId, fileMetadata.name, 0, fileMetadata.size, false, 0, 'Waiting (WebRTC)...');
                            receivedBuffers = []; // Clear buffer if rejected
                            transferProgress.delete(progressId);
                        }
                    });
                } else {
                    receivedBuffers.push(event.data);
                    const receivedSize = receivedBuffers.reduce((acc, val) => acc + val.byteLength, 0);

                    const progressId = `webrtc-recv-${peerId}-${fileMetadata.name}`;
                    const progress = transferProgress.get(progressId);
                    if (progress) {
                        const now = Date.now();
                        const timeDiff = (now - progress.lastTime) / 1000;
                        const sizeDiff = receivedSize - progress.lastSize;
                        const speed = timeDiff > 0.2 ? sizeDiff / timeDiff : progress.lastSpeed;
                        progress.lastSize = receivedSize;
                        progress.lastTime = now;
                        progress.lastSpeed = speed;
                        updateFileProgress(peerId, fileMetadata.name, receivedSize, fileMetadata.size, false, speed);
                    }

                    if (receivedSize === fileMetadata.size) {
                        const fileBlob = new Blob(receivedBuffers);
                        const downloadUrl = URL.createObjectURL(fileBlob);
                        const a = document.createElement('a');
                        a.href = downloadUrl;
                        a.download = fileMetadata.name;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(downloadUrl);
                        a.remove();
                        transferProgress.delete(progressId);
                        receivedBuffers = [];
                    }
                }
            };
        };

        peerConnections.set(peerId, peerConnection);
        return peerConnection;
    }

    async function handleOffer(fromId, offer) {
        const peerConnection = await createPeerConnection(fromId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage(fromId, { type: 'answer', answer });
    }

    async function handleAnswer(fromId, answer) {
        const peerConnection = peerConnections.get(fromId);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async function handleCandidate(fromId, candidate) {
        const peerConnection = peerConnections.get(fromId);
        if (peerConnection.remoteDescription) { // Ensure remote description is set
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }

    function addPeer(user) {
        if (peers.has(user.id)) return;
        const peerNode = peerTemplate.content.cloneNode(true).firstElementChild;
        peerNode.dataset.peerId = user.id;
        peerNode.querySelector('.peer-name').textContent = user.name;
        const avatarNode = peerNode.querySelector('.avatar');
        const hash = user.id.split('').reduce((acc, char) => char.charCodeAt(0) + acc, 0);
        const hue1 = hash % 360, hue2 = (hash * 1.618) % 360;
        avatarNode.style.backgroundImage = `linear-gradient(45deg, hsl(${hue1}, 70%, 60%), hsl(${hue2}, 70%, 50%))`;
        addDragDropHandlers(avatarNode);
        addClickToSendHandler(avatarNode);
        peersContainer.appendChild(peerNode);
        peers.set(user.id, { user, node: peerNode });
    }

    function removePeer(id) {
        const peer = peers.get(id);
        if (peer) {
            peer.node.remove();
            peers.delete(id);
            peerConnections.delete(id);
        }
    }

    async function initiateFileTransfer(recipientId, file) {
        updateFileProgress(selfId, file.name, 0, file.size, true, 0, 'Connecting (WebRTC)...');

        const peerConnection = await createPeerConnection(recipientId);
        const dataChannel = peerConnection.createDataChannel('file-transfer');
        fileToSend.set(recipientId, { file, dataChannel });

        dataChannel.onopen = () => {
            console.log(`Data channel opened with ${recipientId}`);
            const metadata = { name: file.name, size: file.size, type: file.type };
            dataChannel.send(JSON.stringify(metadata));

            const progressId = `webrtc-send-${recipientId}-${file.name}`;
            transferProgress.set(progressId, { lastSize: 0, lastTime: Date.now(), lastSpeed: 0 });

            const chunkSize = 16384; // 16KB
            let offset = 0;
            const reader = new FileReader();

            reader.onload = (e) => {
                dataChannel.send(e.target.result);
                offset += e.target.result.byteLength;

                const progress = transferProgress.get(progressId);
                const now = Date.now();
                const timeDiff = (now - progress.lastTime) / 1000; // in seconds
                const sizeDiff = offset - progress.lastSize;
                // Update speed only if enough time has passed to get a stable reading
                const speed = timeDiff > 0.2 ? sizeDiff / timeDiff : progress.lastSpeed;
                progress.lastSize = offset;
                progress.lastTime = now;
                progress.lastSpeed = speed;
                updateFileProgress(selfId, file.name, offset, file.size, true, speed);

                if (offset < file.size) {
                    readSlice(offset);
                } else {
                    transferProgress.delete(progressId);
                }
            };

            const readSlice = o => {
                const slice = file.slice(o, o + chunkSize);
                reader.readAsArrayBuffer(slice);
            };
            readSlice(0);
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendMessage(recipientId, { type: 'offer', offer });
    }

    /**
     * Fallback file transfer method using the WebSocket server as a relay.
     * @param {string} recipientId The ID of the user to send the file to.
     * @param {File} file The file to send.
     */
    function sendFileViaWebSocket(recipientId, file) {
        // This function now only sends the initial request and waits for acceptance.
        updateFileProgress(selfId, file.name, 0, file.size, true, 0, 'Waiting for accept (Relay)...');
        const metadata = { name: file.name, size: file.size, type: file.type };
        sendMessage(recipientId, { type: 'ws-file-start', metadata });
        // The file is already stored in `fileToSend` by the caller (initiateFileTransfer).
    }

    /**
     * Handles the receiver's acceptance of a WebSocket file transfer.
     * This is called on the SENDER's side.
     * @param {string} fromId The ID of the receiver who accepted.
     */
    function handleWsFileAccept(fromId) {
        const transfer = fileToSend.get(fromId);
        if (!transfer) {
            console.error(`Received a ws-file-accept from ${fromId}, but no file was pending.`);
            return;
        }
        updateFileProgress(selfId, transfer.file.name, 0, transfer.file.size, true, 0, 'Sending (Relay)...');
        startSendingWsChunks(fromId, transfer.file);
    }

    /**
     * Handles the receiver's rejection of a WebSocket file transfer.
     * This is called on the SENDER's side.
     * @param {string} fromId The ID of the receiver who rejected.
     */
    function handleWsFileReject(fromId) {
        const transfer = fileToSend.get(fromId);
        if (transfer) {
            showNotification(`File transfer to ${peers.get(fromId)?.user.name || 'peer'} was rejected.`, 'error');
            // Clean up the progress bar
            const progressId = `progress-${selfId}-${transfer.file.name.replace(/\W/g, '_')}`;
            const progressWrapper = document.getElementById(progressId);
            if (progressWrapper) progressWrapper.remove();

            fileToSend.delete(fromId);
            transferProgress.delete(`ws-send-${fromId}-${transfer.file.name}`);
        }
    }

    /**
     * Starts reading a file and sending it in chunks over WebSocket.
     * @param {string} recipientId The ID of the recipient.
     * @param {File} file The file to send.
     */
    function startSendingWsChunks(recipientId, file) {
        const progressId = `ws-send-${recipientId}-${file.name}`;
        transferProgress.set(progressId, { lastSize: 0, lastTime: Date.now(), lastSpeed: 0 });

        const chunkSize = 131072; // 128KB chunks
        let offset = 0;
        const reader = new FileReader();

        reader.onload = (e) => {
            const base64Chunk = e.target.result.split(',')[1];
            sendMessage(recipientId, { type: 'ws-file-chunk', chunk: base64Chunk });

            offset += chunkSize;
            if (offset > file.size) offset = file.size;

            const progress = transferProgress.get(progressId);
            if (progress) {
                const now = Date.now();
                const timeDiff = (now - progress.lastTime) / 1000;
                const sizeDiff = offset - progress.lastSize;
                const speed = timeDiff > 0.2 ? sizeDiff / timeDiff : progress.lastSpeed;
                progress.lastSize = offset;
                progress.lastTime = now;
                progress.lastSpeed = speed;
                updateFileProgress(selfId, file.name, offset, file.size, true, speed);
            }

            if (offset < file.size) {
                readSlice(offset);
            } else {
                sendMessage(recipientId, { type: 'ws-file-end' });
                transferProgress.delete(progressId);
                fileToSend.delete(recipientId); // Transfer complete, clean up.
            }
        };

        const readSlice = o => {
            const slice = file.slice(o, o + chunkSize);
            reader.readAsDataURL(slice);
        };
        readSlice(0);
    }

    function handleWsFileStart(fromId, metadata) {
        showIncomingFileToast(peers.get(fromId).user, metadata, (accept) => {
            if (accept) {
                const progressId = `ws-recv-${fromId}-${metadata.name}`;
                transferProgress.set(progressId, { lastSize: 0, lastTime: Date.now(), lastSpeed: 0 });
                updateFileProgress(fromId, metadata.name, 0, metadata.size, false, 0, 'Waiting (Relay)...');
                incomingWsFiles.set(fromId, { metadata, receivedSize: 0, chunks: [] });
                sendMessage(fromId, { type: 'ws-file-accept' });
            } else {
                transferProgress.delete(`ws-recv-${fromId}-${metadata.name}`);
                sendMessage(fromId, { type: 'ws-file-reject' });
            }
        });
    }

    function handleWsFileChunk(fromId, base64Chunk) {
        const fileData = incomingWsFiles.get(fromId);
        if (!fileData) return; // Transfer was rejected or hasn't started

        const binaryString = atob(base64Chunk);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        fileData.chunks.push(bytes);
        fileData.receivedSize += bytes.byteLength;

        const progressId = `ws-recv-${fromId}-${fileData.metadata.name}`;
        const progress = transferProgress.get(progressId);
        if (progress) {
            const now = Date.now();
            const timeDiff = (now - progress.lastTime) / 1000;
            const sizeDiff = fileData.receivedSize - progress.lastSize;
            const speed = timeDiff > 0.2 ? sizeDiff / timeDiff : progress.lastSpeed;
            progress.lastSize = fileData.receivedSize;
            progress.lastTime = now;
            progress.lastSpeed = speed;
            updateFileProgress(fromId, fileData.metadata.name, fileData.receivedSize, fileData.metadata.size, false, speed);
        }
    }

    function handleWsFileEnd(fromId) {
        const fileData = incomingWsFiles.get(fromId);
        if (!fileData) return;

        const fileBlob = new Blob(fileData.chunks, { type: fileData.metadata.type });
        const downloadUrl = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileData.metadata.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        a.remove();

        transferProgress.delete(`ws-recv-${fromId}-${fileData.metadata.name}`);
        incomingWsFiles.delete(fromId);
    }

    function handleFileSelect(files, avatarNode) {
        if (files.length > 0) {
            const recipientId = avatarNode.closest('.peer').dataset.peerId;
            const file = files[0];
            const transferModeSelect = document.getElementById('transfer-mode-select');
            const transferMode = transferModeSelect ? transferModeSelect.value : 'webrtc';

            if (transferMode === 'websocket') {
                // Manually set up for WebSocket fallback path, skipping WebRTC
                fileToSend.set(recipientId, { file, dataChannel: null });
                sendFileViaWebSocket(recipientId, file);
            } else { // 'webrtc' or default
                initiateFileTransfer(recipientId, file);
            }
        }
    }

    function addDragDropHandlers(avatarNode) {
        avatarNode.addEventListener('dragover', (e) => { e.preventDefault(); avatarNode.classList.add('drag-over'); });
        avatarNode.addEventListener('dragleave', () => avatarNode.classList.remove('drag-over'));
        avatarNode.addEventListener('drop', (e) => {
            e.preventDefault();
            avatarNode.classList.remove('drag-over');
            handleFileSelect(e.dataTransfer.files, avatarNode);
        });
    }

    function addClickToSendHandler(avatarNode) {
        avatarNode.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.style.display = 'none';
            fileInput.onchange = () => {
                handleFileSelect(fileInput.files, avatarNode);
                document.body.removeChild(fileInput);
            };
            document.body.appendChild(fileInput);
            fileInput.click();
        });
    }
});
