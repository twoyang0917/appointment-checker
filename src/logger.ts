import fs from 'fs';
import path from 'path';

interface LoggerConfig {
    enabled: boolean;
    logDir: string;
    logFile: string;
    maxFileSize: number;
    maxFiles: number;
}

class Logger {
    private config: LoggerConfig;
    private currentLogFile: string;
    private currentSize: number = 0;

    constructor(config: LoggerConfig) {
        this.config = config;
        this.currentLogFile = path.join(config.logDir, config.logFile);
        this.init();
    }

    private init() {
        if (!this.config.enabled) {
            return;
        }

        try {
            if (!fs.existsSync(this.config.logDir)) {
                fs.mkdirSync(this.config.logDir, { recursive: true });
            }

            if (fs.existsSync(this.currentLogFile)) {
                const stats = fs.statSync(this.currentLogFile);
                this.currentSize = stats.size;
            }
        } catch (error) {
            console.error('初始化日志系统失败:', error);
        }
    }

    private formatMessage(level: string, message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] ${message}`;
    }

    private rotateLog() {
        if (this.currentSize >= this.config.maxFileSize) {
            try {
                for (let i = this.config.maxFiles - 1; i >= 1; i--) {
                    const oldFile = path.join(this.config.logDir, `${this.config.logFile}.${i}`);
                    const newFile = path.join(this.config.logDir, `${this.config.logFile}.${i + 1}`);
                    
                    if (fs.existsSync(oldFile)) {
                        if (i === this.config.maxFiles - 1) {
                            fs.unlinkSync(oldFile);
                        } else {
                            fs.renameSync(oldFile, newFile);
                        }
                    }
                }

                const rotatedFile = path.join(this.config.logDir, `${this.config.logFile}.1`);
                fs.renameSync(this.currentLogFile, rotatedFile);
                this.currentSize = 0;
            } catch (error) {
                console.error('日志轮转失败:', error);
            }
        }
    }

    private writeToFile(message: string) {
        if (!this.config.enabled) {
            return;
        }

        try {
            this.rotateLog();
            
            const logEntry = message + '\n';
            fs.appendFileSync(this.currentLogFile, logEntry);
            this.currentSize += logEntry.length;
        } catch (error) {
            console.error('写入日志文件失败:', error);
        }
    }

    info(message: string) {
        const formattedMessage = this.formatMessage('INFO', message);
        console.log(formattedMessage);
        this.writeToFile(formattedMessage);
    }

    warn(message: string) {
        const formattedMessage = this.formatMessage('WARN', message);
        console.warn(formattedMessage);
        this.writeToFile(formattedMessage);
    }

    error(message: string) {
        const formattedMessage = this.formatMessage('ERROR', message);
        console.error(formattedMessage);
        this.writeToFile(formattedMessage);
    }
}

export { Logger, LoggerConfig };