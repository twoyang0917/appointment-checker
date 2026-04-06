import * as cheerio from 'cheerio';
import { config, logger } from './config';
import { sendNotification } from './notifier';

const APPOINTMENT_LINK_TEXT = "点此立即前往预约";

function getAppointmentLink(): string {
    return `### [>> ${APPOINTMENT_LINK_TEXT} <<](${config.doctorPageUrl})`;
}

// --- 状态管理 ---
// 用于故障通知的冷却，防止在持续故障时轰炸用户。单位: 毫秒
let lastErrorNotificationTimestamp = 0;
const ERROR_NOTIFICATION_COOLDOWN = 60 * 60 * 1000; // 1小时

// 用于通知冷却，防止过于频繁的通知。单位: 毫秒
let lastNotificationTimestamp = 0;

/**
 * 处理并发送错误通知（带冷却功能）
 * @param title 故障标题
 * @param message 故障详情
 */
async function handleError(title: string, message: string) {
    logger.error(`${title} ${message}`);
    const now = Date.now();
    if (now - lastErrorNotificationTimestamp > ERROR_NOTIFICATION_COOLDOWN) {
        logger.info("错误冷却时间已过，准备发送故障通知...");
        const markdownMessage = `程序在运行时遇到问题，请关注：\n\n**${message}**`;
        await sendNotification(`【挂号助手故障提醒】 - ${title}`, markdownMessage);
        lastErrorNotificationTimestamp = now;
    } else {
        logger.info("故障通知仍在冷却中，本次不发送。");
    }
}

/**
 * 获取当前北京时间的"今天"日期
 * @returns 北京时间下的 Date 对象
 */
function getBeijingDate(): Date {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2' });
    const [year, month, day] = formatter.format(now).split('/').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * 计算今天应该抢哪天的号（就诊日的前三天）
 * @returns 目标日期字符串 (YYYY-MM-DD)
 */
export function getTargetDate(): string {
    const today = getBeijingDate();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + 3);
    
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const day = String(targetDate.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
}

/**
 * 检查医生预约状态
 */
async function checkAppointmentStatus() {
    logger.info(`[${new Date().toLocaleTimeString()}] 开始检查医生页面...`);

    try {
        // 添加超时处理，避免网络请求卡住
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
        
        const response = await fetch(config.doctorPageUrl, {
            headers: {
                'User-Agent': config.userAgent,
                'Cookie': config.cookie,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/wxpic,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Upgrade-Insecure-Requests': '1',
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorMessage = `请求预约页面失败，状态码: ${response.status}。很可能是 Cookie 已失效，请及时更新。`;
            await handleError("请求失败", errorMessage);
            return;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const doctorName = $('p:contains("姓名：")').text().replace('姓名：', '').trim();
        const targetDate = getTargetDate();
        
        logger.info(`今天需要抢 ${targetDate} 的号`);

        const availableSlots: string[] = [];
        const targetSlotStatus: string[] = [];

        // 检查是否在头痛专病门诊部分
        let isHeadacheClinic = false;

        $('#time .weui-cell').each((index, element) => {
            const cell = $(element);
            
            // 检查是否是头痛专病门诊标题
            if (cell.find('h4').length > 0 && cell.find('h4').text().includes('头痛专病门诊')) {
                isHeadacheClinic = true;
                logger.info('发现头痛专病门诊部分');
                return; // 跳过标题行
            }
            
            // 如果是头痛专病门诊且配置为跳过，则跳过
            if (isHeadacheClinic && config.skipHeadacheClinic) {
                logger.info('跳过头痛专病门诊');
                return;
            }

            const button = cell.find('.weui-btn');
            
            if (button.length > 0) {
                const status = button.text().trim();
                const date = cell.find('p:contains("日期")').text().trim().replace('日期：', '');
                const period = cell.find('p:contains("时段")').text().trim().replace('时段：', '');
                const day = cell.find('p:contains("星期")').text().trim();
                const remaining = cell.find('p:contains("剩余/总数")').text().trim();
                
                // 记录所有号源状态
                logger.info(`号源状态: ${date} ${day} ${period} - ${status} - ${remaining}`);
                
                // 检查是否是目标日期的号
                if (date === targetDate) {
                    targetSlotStatus.push(`${date} ${day} ${period} - ${status} - ${remaining}`);
                }
                
                // 只将真正可预约的号源视为可用（跳过停止预约、已约满和未开始状态）
                if (status !== '停止预约' && status !== '已约满' && status !== '未开始') {
                    const slotDetails = `${date} ${day} ${period} - ${status} - ${remaining}`;
                    availableSlots.push(slotDetails);
                } else {
                    logger.info(`跳过状态: ${status} 的号源`);
                }
            }
        });

        // 通知冷却逻辑
        const now = Date.now();
        const isCombatMode = scanInterval === config.scanIntervals.combat * 1000;
        const notificationCooldown = isCombatMode ? config.notificationCooldown.combat * 1000 : config.notificationCooldown.regular * 1000;

        // 测试模式下总是发送通知（用于测试发消息能力）
        const isTestMode = process.env.BUN_ENV === 'test' || process.env.NODE_ENV === 'test';
        const isCooldownPassed = now - lastNotificationTimestamp > notificationCooldown;
        const shouldNotify = isTestMode || (availableSlots.length > 0 && isCooldownPassed);

        if (shouldNotify) {
            let title: string;
            let markdownContent: string;

            if (isTestMode) {
                title = `🧪 测试模式：${availableSlots.length > 0 ? '发现可预约号源' : '暂未发现号源'}`;
                markdownContent = buildNotificationMarkdown(doctorName, targetDate, targetSlotStatus, availableSlots);
            } else {
                title = `🎉 发现可预约号源！`;
                markdownContent = buildNotificationMarkdown(doctorName, targetDate, targetSlotStatus, availableSlots);
                lastNotificationTimestamp = now;
            }

            logger.info(`${isTestMode ? '🧪 测试模式' : '🎉 发现可预约号源'}！准备发送 Markdown 通知...`);
            await sendNotification(title, markdownContent);
        } else if (availableSlots.length > 0) {
            logger.info('发现可预约号源，但在冷却期内，跳过发送。');
        } else {
            logger.info('暂无可用号源。');
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof Error && error.name === 'AbortError') {
            await handleError("请求超时", "网络请求超时，请检查网络连接或服务器状态。");
        } else {
            await handleError("程序运行异常", message);
        }
    }
}

/**
 * 获取目标日期的号源状态
 * @param html 医生页面的 HTML 内容
 * @param targetDate 目标日期
 * @returns 号源状态数组
 */
function getTargetDateSlotStatus(html: string, targetDate: string): string[] {
    const $ = cheerio.load(html);
    const targetSlotStatus: string[] = [];
    let isHeadacheClinic = false;
    
    $('#time .weui-cell').each((index, element) => {
        const cell = $(element);
        
        // 检查是否是头痛专病门诊标题
        if (cell.find('h4').length > 0 && cell.find('h4').text().includes('头痛专病门诊')) {
            isHeadacheClinic = true;
            return; // 跳过标题行
        }
        
        // 如果是头痛专病门诊且配置为跳过，则跳过
        if (isHeadacheClinic && config.skipHeadacheClinic) {
            return;
        }
        
        const button = cell.find('.weui-btn');
        
        if (button.length > 0) {
            const status = button.text().trim();
            const date = cell.find('p:contains("日期")').text().trim().replace('日期：', '');
            const period = cell.find('p:contains("时段")').text().trim().replace('时段：', '');
            const day = cell.find('p:contains("星期")').text().trim();
            const remaining = cell.find('p:contains("剩余/总数")').text().trim();
            
            // 只记录目标日期的状态
            if (date === targetDate) {
                targetSlotStatus.push(`${date} ${day} ${period} - ${status} - ${remaining}`);
            }
        }
    });
    
    return targetSlotStatus;
}

/**
 * 构造挂号通知的 Markdown 内容
 * @param doctorName 医生姓名
 * @param targetDate 目标日期
 * @param targetSlotStatus 目标日期号源状态
 * @param availableSlots 所有可预约号源
 * @returns Markdown 格式的通知内容
 */
function buildNotificationMarkdown(
    doctorName: string | null,
    targetDate: string,
    targetSlotStatus: string[],
    availableSlots: string[]
): string {
    let markdownContent = `🎯 **目标日期：${targetDate}**（就诊日前3天）

`;
    
    if (targetSlotStatus.length > 0) {
        markdownContent += `📋 目标日期状态：

${targetSlotStatus.map(slot => `* ${slot}`).join('\n')}

`;
    } else {
        markdownContent += `📋 目标日期状态：

* ${targetDate} 暂未放号

`;
    }
    
    if (availableSlots.length > 0) {
        markdownContent += `✅ **可预约号源**（${availableSlots.length}个）：

${availableSlots.map(slot => `* ${slot}`).join('\n')}

`;
    }
    
    markdownContent += getAppointmentLink();
    
    return markdownContent;
}

/**
 * 构造放号提醒消息
 */
function buildReleaseReminderMessage(timeStr: string, minutes: number, targetDate: string, targetSlotStatus?: string[]): string {
    const hasStatus = targetSlotStatus && targetSlotStatus.length > 0;
    const statusText = hasStatus 
        ? targetSlotStatus.map(slot => `* ${slot}`).join('\n')
        : `* ${targetDate} 暂未放号`;
    
    const statusSection = hasStatus 
        ? `\n📋 当前状态：\n${statusText}\n`
        : `（就诊日前3天）\n`;
    
    return `⏰ 距离 ${timeStr} 放号还有 **${minutes} 分钟**，请准备！

🎯 目标日期：**${targetDate}**${statusSection}
${getAppointmentLink()}`;
}

// --- 状态管理 ---
let scanInterval = config.scanIntervals.regular * 1000; // 默认扫描间隔（使用新配置）
let mainIntervalId: NodeJS.Timeout | null = null;
const reminderTimerIds: NodeJS.Timeout[] = []; // 存储所有预告提醒的定时器ID

/**
 * 动态调整扫描频率
 * @param newIntervalSeconds 新的扫描间隔（秒）
 */
function adjustScanInterval(newIntervalSeconds: number) {
    if (mainIntervalId) {
        clearInterval(mainIntervalId);
    }
    scanInterval = newIntervalSeconds * 1000;
    mainIntervalId = setInterval(checkAppointmentStatus, scanInterval);
    logger.info(`🚀 扫描频率已调整为: ${newIntervalSeconds} 秒/次`);
}

/**
 * 获取挂号规则，并为放号时间设置定时提醒和动态频率
 */
async function scheduleRemindersAndFrequency() {
    logger.info('正在获取挂号规则以设置提醒和动态频率...');

    // --- 大扫除：清理掉所有旧的预告提醒定时器 ---
    logger.info(`清理了 ${reminderTimerIds.length} 个旧的预告提醒定时器。`);
    reminderTimerIds.forEach(clearTimeout);
    reminderTimerIds.length = 0; // 清空数组
    // ------------------------------------------

    try {
        const response = await fetch(config.rulesPageUrl, { headers: { 'User-Agent': config.userAgent, 'Cookie': config.cookie } });
        if (!response.ok) {
            await handleError("规则页请求失败", `无法获取挂号规则，状态码: ${response.status}`);
            return;
        }

        const html = await response.text();
        const $ = cheerio.load(html);
        const scriptContent = $('body script').last().html() || '';
        const ruleMatch = scriptContent.match(/\$\.alert\('(.*?)',/);

        if (!ruleMatch || !ruleMatch[1]) {
            logger.info('未找到预约须知规则文本。');
            return;
        }
        const rulesText = ruleMatch[1];

        const timeRegex = /(\d{1,2}:\d{2})/g;
        const releaseTimes = rulesText.match(timeRegex);

        if (!releaseTimes) {
            logger.info('在规则中未找到明确的放号时间。');
            return;
        }

        // 只保留9:00的放号时间，忽略7:00的时间点
        const uniqueTimes = [...new Set(releaseTimes)].filter(time => time === '9:00');
        logger.info(`从规则中解析到放号时间点: ${uniqueTimes.join(', ')}`);
        
        if (uniqueTimes.length === 0) {
            logger.info('未找到9:00的放号时间，使用默认9:00');
            uniqueTimes.push('9:00');
        }

        // 使用UTC+8时区（北京时间）
        const now = getBeijingDate();
        
        uniqueTimes.forEach(timeStr => {
            const [hour, minute] = timeStr.split(':').map(Number);
            
            // 基于北京时间构建目标时间
            const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);

            if (targetTime < now) {
                targetTime.setDate(targetTime.getDate() + 1);
            }

            // 战斗模式开始时间（与第一个提醒时间相同）
            const firstReminderTime = config.reminderMinutesBeforeRelease.length > 0 
                ? targetTime.getTime() - Math.max(...config.reminderMinutesBeforeRelease) * 60 * 1000 
                : targetTime.getTime() - 60 * 60 * 1000; // 默认60分钟
            
            // 战斗模式结束时间（放号后 duration 秒）
            const combatModeEndTime = targetTime.getTime() + config.combatMode.duration * 1000;

            // 获取今天应该抢的号的日期
            const targetDate = getTargetDate();
            
            config.reminderMinutesBeforeRelease.forEach(minutes => {
                const reminderTime = targetTime.getTime() - minutes * 60 * 1000;
                if (reminderTime > now.getTime()) {
                    const timeout = reminderTime - now.getTime();
                    const timerId = setTimeout(async () => {
                        // 发送放号提醒时，先获取当前号源状态
                        try {
                            const response = await fetch(config.doctorPageUrl, {
                                headers: {
                                    'User-Agent': config.userAgent,
                                    'Cookie': config.cookie,
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/wxpic,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                                    'Accept-Language': 'en-US,en;q=0.9',
                                    'Accept-Encoding': 'gzip, deflate',
                                    'Upgrade-Insecure-Requests': '1',
                                }
                            });
                            
                            if (response.ok) {
                                const html = await response.text();
                                
                                // 使用公共函数获取目标日期的号源状态
                                const targetSlotStatus = getTargetDateSlotStatus(html, targetDate);
                                
                                const message = buildReleaseReminderMessage(timeStr, minutes, targetDate, targetSlotStatus);
                                await sendNotification(`⏰ 放号提醒 - 还有${minutes}分钟`, message);
                            } else {
                                const message = buildReleaseReminderMessage(timeStr, minutes, targetDate);
                                await sendNotification(`⏰ 放号提醒 - 还有${minutes}分钟`, message);
                            }
                        } catch (error) {
                            // 如果获取状态失败，发送基本提醒
                            const message = buildReleaseReminderMessage(timeStr, minutes, targetDate);
                            await sendNotification(`⏰ 放号提醒 - 还有${minutes}分钟`, message);
                        }
                    }, timeout);
                    reminderTimerIds.push(timerId);
                    logger.info(`已设置：在 ${new Date(reminderTime).toLocaleString()} 发送放号前${minutes}分钟提醒`);
                }
            });

            if (firstReminderTime > now.getTime()) {
                const startTimeout = firstReminderTime - now.getTime();
                const timerId = setTimeout(() => {
                    logger.info(`⚡️ 进入战斗模式：临近 ${timeStr} 放号时间，扫描频率已提高！`);
                    adjustScanInterval(config.scanIntervals.combat);
                }, startTimeout);
                reminderTimerIds.push(timerId);
                logger.info(`已设置：在 ${new Date(firstReminderTime).toLocaleString()} 进入战斗模式`);
            }

            if (combatModeEndTime > now.getTime()) {
                const endTimeout = combatModeEndTime - now.getTime();
                const timerId = setTimeout(() => {
                    logger.info(`✅ 战斗模式结束：已过 ${timeStr} 放号时间，扫描频率已恢复常规。`);
                    adjustScanInterval(config.scanIntervals.regular);
                }, endTimeout);
                reminderTimerIds.push(timerId);
                logger.info(`已设置：在 ${new Date(combatModeEndTime).toLocaleString()} 恢复常规模式`);
            }
        });

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handleError("解析规则页异常", message);
    }
}

// --- 程序主入口 ---
function start() {
    logger.info('程序启动...');
    // 首次执行
    checkAppointmentStatus();
    scheduleRemindersAndFrequency();

    // 启动常规轮询
    mainIntervalId = setInterval(checkAppointmentStatus, scanInterval);
    logger.info(`已启动常规扫描，频率: ${config.scanIntervals.regular} 秒/次`);

    // 每天重新调度一次，以防日期变化导致定时器失效
    setInterval(scheduleRemindersAndFrequency, 24 * 60 * 60 * 1000);
}

start();


