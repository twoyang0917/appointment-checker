import { config, logger } from './config';

/**
 * 通过 Server酱 发送通知
 * @param title 消息标题
 * @param content 消息内容 (支持 Markdown)
 */
export async function sendNotification(title: string, content: string) {
    if (!config.serverChan.sendKey) {
        logger.warn('未配置 Server酱 SendKey，跳过发送。');
        return;
    }

    const url = `https://sctapi.ftqq.com/${config.serverChan.sendKey}.send`;

    // Server酱 使用 application/x-www-form-urlencoded 格式
    const body = new URLSearchParams();
    body.append('title', title);
    body.append('desp', content);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        const result = await response.json();

        if (result.code === 0) {
            logger.info('成功通过 Server酱 发送通知。');
        } else {
            logger.error(`发送 Server酱 通知失败: ${JSON.stringify(result)}`);
        }
    } catch (error) {
        logger.error(`发送 Server酱 通知时发生严重错误: ${error}`);
    }
}
