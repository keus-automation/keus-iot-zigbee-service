/**
 * Moleculer configuration file for the Zigbee service
 * This configuration is used when the NODE_ENV is set to development
 */

module.exports = {
    // Namespace for the services
    namespace: "akhil_local_zigbee",
    
    // Default log level for built-in console logger
    // Available values: trace, debug, info, warn, error, fatal
    logLevel: process.env.MOLECULER_LOG_LEVEL || "info",
    
    // Log formatter for console logger
    logFormatter: "full", // "full", "simple", "short", or a custom function
    
    // Auto-generated service name prefix
    nodeID: null,

    // Enable/disable metrics collection
    metrics: true,
    
    // Enable the default tracing feature with console reporter.
    tracing: {
        enabled: true,
        exporter: {
            type: "Console", // Console exporter for debugging
            options: {
                width: 100,
                gaugeWidth: 40,
                logger: console,
            }
        }
    },

    // Fallback transporter for local development
    // This is used if no custom transporter is specified in the ServiceBroker options
    transporter: process.env.NODE_ENV === "development" ? null : {
        type: "NATS",
        options: {
            url: "nats://127.0.0.1:4222", // Default local NATS server
        }
    },

    // Enable/disable graceful shutdowns
    shutdownTimeout: 5000,

    // Enable local REPL in development mode
    replCommands: null,
    
    // Register service in the service registry
    registry: {
        strategy: "RoundRobin",
        preferLocal: true
    },

    // Customize circuit breaker settings
    circuitBreaker: {
        enabled: false,
        threshold: 0.5,
        minRequestCount: 20,
        windowTime: 60,
        halfOpenTime: 10 * 1000,
        check: err => err && err.code >= 500
    },

    // Enable parameter validation
    validator: true,
    
    // Error handling settings
    errorHandler(err, info) {
        if (err.code === "MOLECULER_SERVICE_NOT_FOUND") {
            // Handle service not found errors
            this.logger.warn(`Service not found: ${err.data.action}`);
            return;
        }
        
        // Log all other errors
        this.logger.error(`Error occurred!`, err);
    }
}; 