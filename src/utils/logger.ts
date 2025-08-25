export interface Logger {
    debug: (messageOrLambda: string | (() => string), namespace: string) => void;
    info: (messageOrLambda: string | (() => string), namespace: string) => void;
    warning: (messageOrLambda: string | (() => string), namespace: string) => void;
    error: (messageOrLambda: string, namespace: string) => void;
}

export let logger: Logger = {
    debug: (messageOrLambda, namespace) =>
        console.debug(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
    info: (messageOrLambda, namespace) =>
        console.info(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
    warning: (messageOrLambda, namespace) =>
        console.warn(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
    error: (message, namespace) => console.error(`[${new Date().toISOString()}] ${namespace}: ${message}`),
};

export function setLogger(l: Logger): void {
    logger = l;
}

export function setLoggingLevels(levels: string[]): void {

    // Update logger methods to respect the new logging levels
    logger = {
        debug: (messageOrLambda, namespace) =>
            levels.includes('debug') && console.debug(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
        info: (messageOrLambda, namespace) =>
            levels.includes('info') && console.info(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
        warning: (messageOrLambda, namespace) =>
            levels.includes('warning') && console.warn(`[${new Date().toISOString()}] ${namespace}: ${typeof messageOrLambda === 'function' ? messageOrLambda() : messageOrLambda}`),
        error: (message, namespace) => 
            levels.includes('error') && console.error(`[${new Date().toISOString()}] ${namespace}: ${message}`),
    };
}
