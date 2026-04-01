import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Logger, LoggerConfig } from './logger';

interface AppConfig {
    cookie: string;
    pushPlus: {
        token: string;
        topic?: string; // 群组编码，用于群组发送
    };
    scanIntervals: {
        regular: number;    // 常规扫描间隔（秒）
        combat: number;     // 战斗模式扫描间隔（秒）
    };
    combatMode: {
        duration: number;           // 战斗模式持续时间（秒）
    };
    notificationCooldown: {
        combat: number;     // 战斗模式通知冷却时间（秒）
        regular: number;    // 常规模式通知冷却时间（秒）
    };
    reminderMinutesBeforeRelease: number[];
    skipHeadacheClinic?: boolean;
    logging?: {
        enabled?: boolean;
        logDir?: string;
        logFile?: string;
        maxFileSize?: number;
        maxFiles?: number;
    };
}

/**
 * 从指定的 YAML 文件路径加载配置
 * @param configPath 配置文件的路径
 * @returns {AppConfig} 配置对象
 */
function loadConfig(configPath: string): AppConfig {
    try {
        const resolvedPath = path.resolve(configPath);
        const fileContents = fs.readFileSync(resolvedPath, 'utf8');
        const data = yaml.load(fileContents) as AppConfig;

        if (!data.cookie || !data.pushPlus?.token) {
            throw new Error('关键配置缺失！请检查配置文件中是否已正确填写 cookie 和 pushPlus.token。');
        }

        return data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ 读取或解析配置文件 (${configPath}) 时出错: ${message}`);
        console.error("\n💡 请确保配置文件存在且路径正确。如果是首次运行，请从 config.yaml.example 复制一份并重命名为 config.yaml，然后填入您的信息。\n");
        process.exit(1);
    }
}

// --- 命令行参数解析 ---
function parseCliArgs(): string {
    const args = process.argv.slice(2);
    const configFlagIndex = args.findIndex(arg => arg === '-c' || arg === '--config');

    if (configFlagIndex !== -1 && args[configFlagIndex + 1]) {
        return args[configFlagIndex + 1];
    }

    // 如果没有提供 -c 参数，则默认使用根目录的 config.yaml (方便本地开发)
    return 'config.yaml';
}

const configFile = parseCliArgs();
const loadedConfig = loadConfig(configFile);

const loggingConfig: LoggerConfig = {
    enabled: loadedConfig.logging?.enabled ?? false,
    logDir: loadedConfig.logging?.logDir ?? './logs',
    logFile: loadedConfig.logging?.logFile ?? 'appointment-checker.log',
    maxFileSize: loadedConfig.logging?.maxFileSize ?? 10 * 1024 * 1024, // 10MB
    maxFiles: loadedConfig.logging?.maxFiles ?? 5,
};

const logger = new Logger(loggingConfig);

export const config = {
    // --- 从外部配置文件读取的配置 ---
    cookie: loadedConfig.cookie,
    pushPlus: loadedConfig.pushPlus,
    scanIntervals: {
        regular: loadedConfig.scanIntervals?.regular || 300,     // 常规扫描间隔（秒），默认5分钟
        combat: loadedConfig.scanIntervals?.combat || 30,        // 战斗模式扫描间隔（秒），默认30秒
    },
    combatMode: {
        duration: loadedConfig.combatMode?.duration || 600,          // 战斗模式持续时间（秒），默认10分钟
    },
    notificationCooldown: {
        combat: loadedConfig.notificationCooldown?.combat || 180,     // 战斗模式通知冷却时间（秒），默认3分钟
        regular: loadedConfig.notificationCooldown?.regular || 1800,   // 常规模式通知冷却时间（秒），默认30分钟
    },
    reminderMinutesBeforeRelease: loadedConfig.reminderMinutesBeforeRelease || [60, 5, 1],
    skipHeadacheClinic: loadedConfig.skipHeadacheClinic ?? false,

    // --- 静态配置 ---
    doctorPageUrl: 'http://www.bjsfrj.com/weixin/zjsyy/index.php/yuyue/ysxx/ysid/48',
    rulesPageUrl: 'http://www.bjsfrj.com/weixin/zjsyy/index.php/yuyue/index',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf264151c) XWEB/17078 Flue',
};

export { logger };
