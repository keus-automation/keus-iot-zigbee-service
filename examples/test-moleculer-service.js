/**
 * Test script for Moleculer Zigbee service
 * 
 * This script connects to the Moleculer service and tests the available actions.
 * It's useful for debugging and verifying the service is working correctly.
 */

const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const path = require('path');

// Load Moleculer configuration if it exists
let brokerConfig = {};
const configPath = path.resolve(__dirname, 'moleculer.config.js');
if (fs.existsSync(configPath)) {
    brokerConfig = require(configPath);
}

// Environment configuration
const useLocalMode = process.env.USE_LOCAL_MODE === "true" || false;
// Default NATS URL for local testing, ensure this matches the NATS instance used by molecular-service.js
// Can be overridden by the NATS_URL environment variable.
const natsUrl = process.env.NATS_URL || "nats://localhost:4222";
const natsToken = process.env.NATS_TOKEN || 'keus-iot-platform';

// Create a test broker that will connect to the main service
const broker = new ServiceBroker({
    ...brokerConfig,
    nodeID: process.env.NODE_ID || "test-client",
    logLevel: process.env.MOLECULER_LOG_LEVEL || "info",
    // Use transporter only in distributed mode
    transporter: useLocalMode ? null : {
        type: "NATS",
        options: {
            url: natsUrl,
            token: natsToken,
        }
    },
    // Stream heartbeat counter
    heartbeatCounter: 0
});

// Create a test service
broker.createService({
    name: "tester",
    
    // Service created lifecycle event
    created() {
        // Create a stream observer for heartbeat messages
        this.observer = this.broker.createStreamObserver("p1.zigbee.device.heartBeat");
        
        // Listen for heartbeat messages
        this.observer.on("data", message => {
            this.broker.heartbeatCounter++;
            this.logger.info(`[HEARTBEAT ${this.broker.heartbeatCounter}] Device: ${message.deviceId}, Status: ${message.status}, Time: ${new Date(message.timestamp).toISOString()}`);
        });
    },
    
    // Service stopped lifecycle event
    stopped() {
        // Close the stream observer when service stops
        if (this.observer) {
            this.observer.close();
        }
    },
    
    // Service started lifecycle event
    async started() {
        this.logger.info("Test client started");
        
        try {
            // Wait a moment to ensure all services are available
            await this.broker.waitForServices(["zigbee", "zigbeeMonitor"]);
            
            // Test getDevices action
            this.logger.info("Testing zigbee.getDevices action");
            const devices = await this.broker.call("zigbee.getDevices");
            this.logger.info(`Found ${devices.length} device(s):`);
            devices.forEach(device => {
                this.logger.info(`- ${device.ieeeAddr} (${device.type})`);
            });
            
            // Test manual heartbeat sending for a specific device
            if (devices.length > 0) {
                const testDevice = devices[0];
                this.logger.info(`Testing zigbee.pingDevice for device ${testDevice.ieeeAddr} (this will also send a heartbeat)`);
                // Replaced call to non-existent "zigbee.sendHeartbeat" with "zigbee.pingDevice"
                // The pingDevice action will also trigger a heartbeat on "p1.zigbee.device.heartBeat" stream upon success.
                const pingResult = await this.broker.call("zigbee.pingDevice", {
                    deviceId: testDevice.ieeeAddr
                });
                this.logger.info("Ping device result:", pingResult);
            }
            
            // Subscribe to device events
            this.logger.info("Subscribing to device events");
            this.broker.on("zigbee.deviceStatuses", (data) => {
                this.logger.info(`Received deviceStatuses event with ${data.devices.length} device(s)`);
                
                // After receiving status, check device statuses
                this.broker.call("zigbeeMonitor.getDeviceStatuses")
                    .then(statuses => {
                        this.logger.info("Current device statuses:", statuses);
                    });
            });
            
            // Test permit join (30 seconds)
            this.logger.info("Testing zigbee.permitJoin action");
            const permitJoinResult = await this.broker.call("zigbee.permitJoin", { duration: 30 });
            this.logger.info("Permit join result:", permitJoinResult);
            
            this.logger.info("Test client is now monitoring events and heartbeats...");
            
            // The action "zigbee.sendHeartbeatsForAllDevices" is not defined in molecular-service.js.
            // The molecular-service.js handles periodic heartbeats for all devices internally via its pingMonitorDevices method.
            // If you need to test this, you should observe the heartbeats generated by the service itself.
            /*
            // Every 30 seconds, test the sendHeartbeatsForAllDevices action
            setInterval(async () => {
                try {
                    this.logger.info("Testing sendHeartbeatsForAllDevices action");
                    const allHeartbeatsResult = await this.broker.call("zigbee.sendHeartbeatsForAllDevices");
                    this.logger.info(`Sent heartbeats for ${allHeartbeatsResult.totalDevices} devices. Success: ${allHeartbeatsResult.results.filter(r => r.success).length}`);
                } catch (err) {
                    this.logger.error("Error sending heartbeats for all devices:", err);
                }
            }, 30000);
            */
            
        } catch (error) {
            this.logger.error("Error during tests:", error);
            // Exit on error
            process.exit(1);
        }
    }
});

// Start the broker
broker.start()
    .then(() => console.log("Test client broker started successfully"))
    .catch(err => {
        console.error("Failed to start test client broker:", err);
        process.exit(1);
    }); 