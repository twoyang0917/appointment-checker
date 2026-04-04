import { config, logger } from './config';

/**
 * 通过 PushPlus 发送通知
 * @param title 消息标题
 * @param content 消息内容 (支持 Markdown)
 */
export async function sendNotification(title: string, content: string) {
    if (!config.pushPlus.token) {
        logger.warn('未配置 PushPlus Token，跳过发送。');
        return;
    }

    // 测试模式下使用 🧪 emoji 标识，不再加【测试】前缀
    const isTest = process.env.BUN_ENV === 'test' || process.env.NODE_ENV === 'test';
    const finalTitle = title;

    // 在内容末尾添加当前时间（北京时间），以规避 PushPlus 的重复内容检测
    const beijingTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const currentTime = beijingTime.toLocaleString('zh-CN');
    const contentWithTime = `${content}\n\n通知时间：${currentTime}`;

    const url = 'https://www.pushplus.plus/send';

    // PushPlus 使用 application/json 格式
    const body = JSON.stringify({
        token: config.pushPlus.token,
        title: finalTitle,
        content: contentWithTime,
        template: 'markdown',
        topic: config.pushPlus.topic // 群组编码，用于群组发送
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: body,
        });

        const result = await response.json();

        if (result.code === 200) {
            logger.info('成功通过 PushPlus 发送通知。');
        } else {
            logger.error(`发送 PushPlus 通知失败: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        logger.error(`发送 PushPlus 通知时发生严重错误: ${error}`);
    }
}
