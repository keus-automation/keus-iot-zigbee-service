# Keus IoT Zigbee Moleculer Service

This is a microservices-based Zigbee service for managing Keus IoT devices, built with the [Moleculer](https://moleculer.services/) framework. It provides functionalities for device discovery, connection, monitoring, and communication.

## Features

- Microservices architecture with Moleculer
- Service-to-service communication via events
- Exposed service actions for external API access
- Device discovery and connection handling
- Automatic device type identification based on metadata
- Device status monitoring via ping mechanism
- Structured device communication
- Event-based architecture

## Prerequisites

The Moleculer dependency is already included in the main package.json of this project. If you're using this example in another project, make sure to install Moleculer:

```bash
npm install moleculer --save
# or if using pnpm
pnpm add moleculer
```

## Setup

1. Make sure you have a Zigbee adapter connected to your system (default port: COM20)
2. Ensure the database directories exist:
   ```
   mkdir -p ./.zigbee_data
   ```
3. Install all dependencies from the main project:
   ```
   # With npm:
   npm install
   
   # With pnpm (recommended since it's the project's package manager):
   pnpm install
   ```

## Available Examples

- **join-and-log.js**: Simple example that logs Zigbee device events
- **molecular-service.js**: A Moleculer-based implementation of the service with two microservices:
  - `zigbee`: Core service managing Zigbee device communication
  - `zigbeeMonitor`: Auxiliary service monitoring device statuses

## Running the Moleculer Service

You can run the service using the npm script defined in the main package.json:

```bash
# With npm:
npm run start:moleculer

# With pnpm (recommended):
pnpm start:moleculer
```

Or directly with Node.js:

```bash
node examples/molecular-service.js
```

## Configuration

The service uses the following default configuration:

```javascript
{
    SERIAL_PORT: 'COM20',
    DB_PATH: './.zigbee_data/devices.db',
    DB_BACKUP_PATH: './.zigbee_data/devices.db.backup',
    ADAPTER_BACKUP_PATH: './.zigbee_data/adapter.backup',
    KEUS_DEVICE_ENDPOINT: 15,
    KEUS_MASTER_ENDPOINT: 15,
    DEVICE_META_INFO_PATH: path.resolve(__dirname, 'device_meta_info.json'),
    PING_INTERVAL_MS: 10000,
    PERMIT_JOIN_DURATION: 180
}
```

You can modify these values directly in the `CONFIG` object in the molecular-service.js file.

## Microservices Architecture

The service consists of two main microservices:

1. **zigbee**: Core service that handles:
   - Zigbee controller initialization
   - Device discovery and interview
   - Communication with devices
   - Emitting events to other services

2. **zigbeeMonitor**: Monitoring service that:
   - Subscribes to device status updates
   - Maintains a record of device online/offline status
   - Provides device status information through actions

## Service Events

The microservices communicate using events:

- `zigbee.message`: Emitted when a message is received from a device
- `zigbee.permitJoinChanged`: Emitted when the permit join status changes
- `zigbee.deviceJoined`: Emitted when a new device joins
- `zigbee.deviceIdentified`: Emitted when a device is successfully identified
- `zigbee.unknownDeviceType`: Emitted when a device is found but not identified
- `zigbee.unknownDevice`: Emitted when a non-Keus device is found
- `zigbee.deviceInterviewFailed`: Emitted when a device interview fails
- `zigbee.deviceStatuses`: Emitted with statuses of all devices after ping scan

## Service Actions

The Zigbee service exposes the following actions that can be called:

- `zigbee.getDevices`: Gets information about all connected devices
- `zigbee.permitJoin`: Controls permit join functionality with duration parameter
- `zigbee.sendCommand`: Sends a command to a specific device
- `zigbee.pingDevice`: Checks if a specific device is online

The ZigbeeMonitor service exposes:

- `zigbeeMonitor.getDeviceStatuses`: Returns the status of all monitored devices

## Extending the Service

To add custom functionality:

1. Define new actions in existing services
2. Create new microservices that subscribe to events
3. Add new event broadcasters in the existing methods
4. Create API gateway services to expose functionality to external clients 