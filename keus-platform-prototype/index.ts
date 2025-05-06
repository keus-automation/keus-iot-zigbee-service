// import { KeusRealtimeCommunication, ConnectionEvents } from '@keus-automation/kiotp-realtime-js';
import Moleculer from 'moleculer';
import { Middleware as ChannelsMiddleware } from "@moleculer/channels";
import ZigbeeCoordinatorService from './zigbee-coordinator';

const USE_LOCAL_MODE = true;
const NATS_URL = "nats://100.82.115.91:9769";
const NATS_TOKEN = 'keus-iot-platform';
const NAMESPACE = "Keus-199786d6-saiteja-RandomId-af7f2a3ab9b0";

class NodeManager {
    static _serviceBroker: Moleculer.ServiceBroker;

    static getChannelsMiddleware = ({
        streamName = "kiotp-default",
        namespace = NAMESPACE,
        subjects = [`p1.>`, `p2.>`, `default.>`],
        sendMethodName = "sendToStream",
        debug = false,
    }): Moleculer.Middleware => {
        subjects = subjects.map(subject => `${namespace}.${subject}`);
        //@ts-ignore
        return ChannelsMiddleware({
            sendMethodName: sendMethodName,
            adapter: {
                type: "NATS",
                //@ts-ignore
                options: {
                    nats: {
                        url: NATS_URL,
                        connectionOptions: {
                            token: NATS_TOKEN,
                            debug: debug,
                            reconnect: true,
                            maxReconnectAttempts: -1,
                            waitOnFirstConnect: true     
                        },
                        streamConfig: {
                            name: streamName,
                            subjects: subjects,
                            max_age: 12 * 60 * 60 * 1000 * 1000 * 1000 // 12 hours
                        },
                        consumerOptions: {
                            config: {
                                deliver_policy: "new",
                                ack_policy: "explicit",
                                ack_wait: 1 * 60 * 60 * 1000 * 1000 * 1000 // 1 hour
                            }
                        },
                    },
                    maxInFlight: 100000,
                    maxRetries: 5
                }
            },
    
            context: true,
        })
    }

    static async start() {
        NodeManager._serviceBroker = new Moleculer.ServiceBroker({
            namespace: NAMESPACE,
            nodeID: "zcs",
            transporter: USE_LOCAL_MODE ? null : {
                type: "NATS",
                options: {
                    url: NATS_URL,
                    token: NATS_TOKEN,
                }
            },
            middlewares: [
                // Add Channels middleware for persistent messaging
                
                NodeManager.getChannelsMiddleware({})
            ]
        });
        NodeManager._serviceBroker.createService(ZigbeeCoordinatorService);
        await NodeManager._serviceBroker.start();
    
        //permit join
        await NodeManager._serviceBroker.call('v1.zigbee_coordinator.permitJoin', {
            duration: 180
        });
    }
}

(async () => {
    try {
        await NodeManager.start();
    } catch (err) {
        console.log(`Error starting node manager ${err}`, err);
    }
})()