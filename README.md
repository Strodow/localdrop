# LocalDrop

A simple, self-hosted, peer-to-peer file sharing application for your local network.

LocalDrop uses WebRTC to attempt direct peer-to-peer connections for maximum speed and automatically falls back to a WebSocket relay through its server when restrictive networks prevent a direct connection. Your files never touch a third-party cloud service.

## Features

- **Peer-to-Peer Speed:** Uses WebRTC to transfer files directly between browsers for high speed and low latency.
- **Automatic Fallback:** Seamlessly switches to a WebSocket relay when direct connections are not possible.
- **Self-Hosted & Private:** Your files stay on your network. No cloud services are involved in the transfer.
- **Simple UI:** Clean, simple interface with drag-and-drop file sharing.
- **Mobile Friendly:** A QR code makes it easy to connect mobile devices.
- **Containerized:** Easy to deploy and run with Docker.

## How to Run with Docker

This is the recommended way to run LocalDrop.

1.  **Pull the image from Docker Hub:**
    ```bash
    docker pull your-dockerhub-username/localdrop:latest
    ```

2.  **Run the container:**
    You must provide your computer's Local Area Network (LAN) IP address so it can be displayed in the QR code for other devices to connect.

    ```bash
    docker run --rm -p 3000:3000 -e HOST_IP="YOUR_LAN_IP_HERE" your-dockerhub-username/localdrop:latest
    ```
    - Replace `YOUR_LAN_IP_HERE` with your actual IP address (e.g., `192.168.1.52`).
    - **Windows:** Find your IP by running `ipconfig` in Command Prompt.
    - **macOS/Linux:** Find your IP by running `ip a` or `ifconfig` in the terminal.

3.  **Open your browser** and navigate to `http://<YOUR_LAN_IP_HERE>:3000`. You should see the LocalDrop interface.

## Configuration

| Environment Variable | Description                                                                                             | Default |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| `HOST_IP`            | **Required.** The LAN IP address of the host machine. Used for generating the QR code for mobile access. | `null`  |

## Building from Source (for Developers)

If you want to run the application without Docker for development purposes:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-github-username/localdrop.git
    cd localdrop
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Run the Server:**
    The `start` script runs `server/server.js` using `node`.
    ```bash
    npm start
    ```

4.  Open your browser and navigate to `http://<your-local-ip>:3000`.