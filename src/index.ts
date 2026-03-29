import * as cheerio from 'cheerio';
import { config, logger } from './config';
import { sendNotification } from './notifier';

// --- 状态管理 ---
// 用于记录已发送过通知的号源，防止重复发送。key: string (例如: "2026-04-01-全天")
const notifiedSlots = new Set<string>();
// 用于故障通知的冷却，防止在持续故障时轰炸用户。单位: 毫秒
let lastErrorNotificationTimestamp = 0;
const ERROR_NOTIFICATION_COOLDOWN = 60 * 60 * 1000; // 1小时

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
 * 检查医生预约状态
 */
async function checkAppointmentStatus() {
    logger.info(`[${new Date().toLocaleTimeString()}] 开始检查医生页面...`);

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

        if (!response.ok) {
            const errorMessage = `请求预约页面失败，状态码: ${response.status}。很可能是 Cookie 已失效，请及时更新。`;
            await handleError("请求失败", errorMessage);
            return;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const doctorName = $('p:contains("姓名：")').text().replace('姓名：', '').trim();

        const newlyAvailableSlots: string[] = [];

        $('#time .weui-cell').each((index, element) => {
            const cell = $(element);
            const button = cell.find('.weui-btn');

            if (button.length > 0 && !button.hasClass('bg-gray')) {
                const date = cell.find('p:contains("日期")').text().trim().replace('日期：', '');
                const period = cell.find('p:contains("时段")').text().trim().replace('时段：', '');
                const slotId = `${date}-${period}`;

                // 如果这个号源是第一次发现，则加入待通知列表
                if (!notifiedSlots.has(slotId)) {
                    const day = cell.find('p:contains("星期")').text().trim();
                    const remaining = cell.find('p:contains("剩余/总数")').text().trim();
                    const slotDetails = `${date} ${day} ${period} - ${remaining}`;
                    
                    newlyAvailableSlots.push(slotDetails);
                    notifiedSlots.add(slotId); // 加入已通知列表，防止下次重复通知
                }
            }
        });

        if (newlyAvailableSlots.length > 0) {
            const title = `🎉 发现【${doctorName}】有新号源！`;
            const markdownContent = `
## 挂号提醒

发现 **${doctorName}** 医生有新的可预约号源！

---

### 新发现的时间段

${newlyAvailableSlots.map(slot => `> - ${slot}`).join('\n')}

---

### [>> 点击这里，立即前往预约 <<](${config.doctorPageUrl})

(程序已记录以上号源，不会重复提醒)
            `;

            logger.info('🎉 发现新的可预约号源！准备发送 Markdown 通知...');
            await sendNotification(title, markdownContent);
        } else {
            logger.info('暂无 *新* 的可用号源。');
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await handleError("程序运行异常", message);
    }
}

// 立即执行一次检查，然后启动定时器
logger.info('程序启动，立即执行第一次检查...');
checkAppointmentStatus();

setInterval(checkAppointmentStatus, config.scanIntervalSeconds * 1000);

let scanInterval = config.scanIntervalSeconds * 1000; // 默认扫描间隔
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
        const now = new Date();
        const utcOffset = 8; // UTC+8小时
        
        uniqueTimes.forEach(timeStr => {
            const [hour, minute] = timeStr.split(':').map(Number);
            
            // 创建UTC时间，然后调整为UTC+8
            const targetUtcTime = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hour - utcOffset, minute, 0, 0));
            
            // 转换为本地时间进行比较
            const targetTime = new Date(targetUtcTime.getTime());

            if (targetTime < now) {
                // 如果目标时间已过，设置为明天的同一时间
                const tomorrowUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour - utcOffset, minute, 0, 0));
                targetTime.setTime(tomorrowUtc.getTime());
            }

            const combatModeStartTime = targetTime.getTime() - 10 * 60 * 1000;
            const combatModeEndTime = targetTime.getTime() + 1 * 60 * 1000;

            config.reminderMinutesBeforeRelease.forEach(minutes => {
                const reminderTime = targetTime.getTime() - minutes * 60 * 1000;
                if (reminderTime > now.getTime()) {
                    const timeout = reminderTime - now.getTime();
                    const timerId = setTimeout(() => {
                        sendNotification(`⏰ 放号提醒 - 还有${minutes}分钟`, `距离 ${timeStr} 放号还有 ${minutes} 分钟，请做好准备！`);
                    }, timeout);
                    reminderTimerIds.push(timerId);
                    logger.info(`已设置：在 ${new Date(reminderTime).toLocaleString()} 发送放号前${minutes}分钟提醒`);
                }
            });

            if (combatModeStartTime > now.getTime()) {
                const startTimeout = combatModeStartTime - now.getTime();
                const timerId = setTimeout(() => {
                    logger.info(`⚡️ 进入战斗模式：临近 ${timeStr} 放号时间，扫描频率已提高！`);
                    adjustScanInterval(5);
                }, startTimeout);
                reminderTimerIds.push(timerId);
                logger.info(`已设置：在 ${new Date(combatModeStartTime).toLocaleString()} 进入战斗模式`);
            }

            if (combatModeEndTime > now.getTime()) {
                const endTimeout = combatModeEndTime - now.getTime();
                const timerId = setTimeout(() => {
                    logger.info(`✅ 战斗模式结束：已过 ${timeStr} 放号时间，扫描频率已恢复常规。`);
                    adjustScanInterval(config.scanIntervalSeconds);
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
    logger.info(`已启动常规扫描，频率: ${config.scanIntervalSeconds} 秒/次`);

    // 每天重新调度一次，以防日期变化导致定时器失效
    setInterval(scheduleRemindersAndFrequency, 24 * 60 * 60 * 1000);
}

start();


