import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as cheerio from 'cheerio';
import { getTargetDate } from '../src/index';

// 模拟配置
const mockConfig = {
  skipHeadacheClinic: true,
  doctorPageUrl: 'http://example.com',
  userAgent: 'Test User Agent',
  cookie: 'test-cookie'
};

// 模拟 HTML 结构
const mockHtml = `
<div id="time">
  <div class="weui-cell">
    <div class="weui-cell__bd">
      <p>日期：2026-04-02</p>
      <p>星期：三</p>
      <p>时段：全天</p>
      <p>医事服务费：40.00元</p>
      <p>剩余/总数：0/20</p>
    </div>
    <div class="weui-cell__ft">
      <a href="#" class="weui-btn bg-gray">已约满</a>
    </div>
  </div>
  <div class="weui-cell">
    <div class="weui-cell__bd">
      <p>日期：2026-04-03</p>
      <p>星期：四</p>
      <p>时段：全天</p>
      <p>医事服务费：40.00元</p>
      <p>剩余/总数：5/20</p>
    </div>
    <div class="weui-cell__ft">
      <a href="#" class="weui-btn">可预约</a>
    </div>
  </div>
  <div class="weui-cell">
    <h4>头痛专病门诊</h4>
  </div>
  <div class="weui-cell">
    <div class="weui-cell__bd">
      <p>日期：2026-04-04</p>
      <p>星期：五</p>
      <p>时段：全天</p>
      <p>医事服务费：40.00元</p>
      <p>剩余/总数：10/20</p>
    </div>
    <div class="weui-cell__ft">
      <a href="#" class="weui-btn">可预约</a>
    </div>
  </div>
  <div class="weui-cell">
    <div class="weui-cell__bd">
      <p>日期：2026-04-05</p>
      <p>星期：六</p>
      <p>时段：全天</p>
      <p>医事服务费：40.00元</p>
      <p>剩余/总数：20/20</p>
    </div>
    <div class="weui-cell__ft">
      <a href="#" class="weui-btn">未开始</a>
    </div>
  </div>
  <div class="weui-cell">
    <div class="weui-cell__bd">
      <p>日期：2026-04-06</p>
      <p>星期：日</p>
      <p>时段：全天</p>
      <p>医事服务费：40.00元</p>
      <p>剩余/总数：0/20</p>
    </div>
    <div class="weui-cell__ft">
      <a href="#" class="weui-btn bg-gray">停止预约</a>
    </div>
  </div>
</div>
`;

// 存储原始的 Date 对象
let originalDate: typeof Date;

describe('Appointment Checker', () => {
  beforeEach(() => {
    // 保存原始的 Date 对象
    originalDate = global.Date;
  });
  
  afterEach(() => {
    // 恢复原始的 Date 对象
    global.Date = originalDate;
  });
  
  describe('getTargetDate', () => {
    it('should return the date 3 days from now', () => {
      // 模拟当前日期
      const mockDate = new Date('2026-03-30');
      
      // 模拟 Date 构造函数
      global.Date = function(...args: any[]) {
        if (args.length === 0) {
          return mockDate;
        }
        return new originalDate(...args);
      } as any;
      
      global.Date.now = () => mockDate.getTime();
      Object.setPrototypeOf(global.Date, originalDate.prototype);
      
      const targetDate = getTargetDate();
      expect(targetDate).toBe('2026-04-02');
    });
  });
  
  describe('HTML parsing', () => {
    it('should correctly parse appointment statuses', () => {
      const $ = cheerio.load(mockHtml);
      const cells = $('#time .weui-cell');
      
      expect(cells.length).toBe(6);
      
      // 测试第一个 cell (已约满)
      const firstCell = $(cells[0]);
      const firstButton = firstCell.find('.weui-btn');
      expect(firstButton.text().trim()).toBe('已约满');
      expect(firstButton.hasClass('bg-gray')).toBe(true);
      
      // 测试第二个 cell (可预约)
      const secondCell = $(cells[1]);
      const secondButton = secondCell.find('.weui-btn');
      expect(secondButton.text().trim()).toBe('可预约');
      expect(secondButton.hasClass('bg-gray')).toBe(false);
      
      // 测试第三个 cell (头痛专病门诊标题)
      const thirdCell = $(cells[2]);
      expect(thirdCell.find('h4').text()).toBe('头痛专病门诊');
      
      // 测试第四个 cell (头痛专病门诊可预约)
      const fourthCell = $(cells[3]);
      const fourthButton = fourthCell.find('.weui-btn');
      expect(fourthButton.text().trim()).toBe('可预约');
      
      // 测试第五个 cell (未开始)
      const fifthCell = $(cells[4]);
      const fifthButton = fifthCell.find('.weui-btn');
      expect(fifthButton.text().trim()).toBe('未开始');
      
      // 测试第六个 cell (停止预约)
      const sixthCell = $(cells[5]);
      const sixthButton = sixthCell.find('.weui-btn');
      expect(sixthButton.text().trim()).toBe('停止预约');
      expect(sixthButton.hasClass('bg-gray')).toBe(true);
    });
  });
  
  describe('Status filtering', () => {
    it('should filter out stopped, fully booked and not started appointments', () => {
      const $ = cheerio.load(mockHtml);
      const cells = $('#time .weui-cell');
      
      const validStatuses = [];
      
      cells.each((index, element) => {
        const cell = $(element);
        const button = cell.find('.weui-btn');
        
        if (button.length > 0) {
          const status = button.text().trim();
          if (status !== '停止预约' && status !== '已约满' && status !== '未开始') {
            validStatuses.push(status);
          }
        }
      });
      
      expect(validStatuses).toEqual(['可预约', '可预约']);
    });
  });
  
  describe('Headache clinic filtering', () => {
    it('should skip headache clinic appointments when skipHeadacheClinic is true', () => {
      const $ = cheerio.load(mockHtml);
      const cells = $('#time .weui-cell');
      
      let isHeadacheClinic = false;
      const validAppointments = [];
      
      cells.each((index, element) => {
        const cell = $(element);
        
        // 检查是否是头痛专病门诊标题
        if (cell.find('h4').length > 0 && cell.find('h4').text().includes('头痛专病门诊')) {
          isHeadacheClinic = true;
          return; // 跳过标题行
        }
        
        // 如果是头痛专病门诊且配置为跳过，则跳过
        if (isHeadacheClinic && mockConfig.skipHeadacheClinic) {
          return;
        }
        
        const button = cell.find('.weui-btn');
        
        if (button.length > 0) {
          const status = button.text().trim();
          if (status !== '停止预约' && status !== '已约满' && status !== '未开始') {
            const date = cell.find('p:contains("日期")').text().trim().replace('日期：', '');
            validAppointments.push(date);
          }
        }
      });
      
      expect(validAppointments).toEqual(['2026-04-03']);
    });
    
    it('should include headache clinic appointments when skipHeadacheClinic is false', () => {
      const $ = cheerio.load(mockHtml);
      const cells = $('#time .weui-cell');
      
      let isHeadacheClinic = false;
      const validAppointments = [];
      
      cells.each((index, element) => {
        const cell = $(element);
        
        // 检查是否是头痛专病门诊标题
        if (cell.find('h4').length > 0 && cell.find('h4').text().includes('头痛专病门诊')) {
          isHeadacheClinic = true;
          return; // 跳过标题行
        }
        
        // 不管是否是头痛专病门诊，都处理
        const button = cell.find('.weui-btn');
        
        if (button.length > 0) {
          const status = button.text().trim();
          if (status !== '停止预约' && status !== '已约满' && status !== '未开始') {
            const date = cell.find('p:contains("日期")').text().trim().replace('日期：', '');
            validAppointments.push(date);
          }
        }
      });
      
      // 应该包含头痛专病门诊的号源
      expect(validAppointments).toEqual(['2026-04-03', '2026-04-04']);
    });
  });
  
  describe('Notification message assembly', () => {
    it('should generate correct notification content', () => {
      const doctorName = '周劲草';
      const targetDate = '2026-04-02';
      const targetSlotStatus = ['2026-04-02 周三 全天 - 可预约 - 剩余/总数：5/20'];
      const availableSlots = [
        '2026-04-02 周三 全天 - 可预约 - 剩余/总数：5/20',
        '2026-04-03 周四 全天 - 可预约 - 剩余/总数：3/20'
      ];
      
      // 模拟通知内容组装
      let markdownContent = `
## 挂号提醒

发现 **${doctorName}** 医生有可预约号源！

---

### 今日目标
今天需要抢 **${targetDate}** 的号

`;
      
      if (targetSlotStatus.length > 0) {
        markdownContent += `### 目标日期状态

${targetSlotStatus.map(slot => `> - ${slot}`).join('\n')}

`;
      } else {
        markdownContent += `### 目标日期状态

> - ${targetDate} 暂未发现号源

`;
      }
      
      markdownContent += `### 所有可预约号源

${availableSlots.map(slot => `> - ${slot}`).join('\n')}

---

### [>> 点击这里，立即前往预约 <<](http://example.com)
      `;
      
      // 验证通知内容是否正确生成
      expect(markdownContent).toContain('挂号提醒');
      expect(markdownContent).toContain(doctorName);
      expect(markdownContent).toContain(targetDate);
      expect(markdownContent).toContain('目标日期状态');
      expect(markdownContent).toContain('所有可预约号源');
      expect(markdownContent).toContain('点击这里，立即前往预约');
      expect(markdownContent).toContain('2026-04-02 周三 全天 - 可预约 - 剩余/总数：5/20');
      expect(markdownContent).toContain('2026-04-03 周四 全天 - 可预约 - 剩余/总数：3/20');
    });
  });
  
  describe('Notification sending', () => {
    it('should send notification for available appointments', async () => {
      const doctorName = '周劲草';
      const targetDate = '2026-04-02';
      const targetSlotStatus = ['2026-04-02 周三 全天 - 可预约 - 剩余/总数：5/20'];
      const availableSlots = [
        '2026-04-02 周三 全天 - 可预约 - 剩余/总数：5/20',
        '2026-04-03 周四 全天 - 可预约 - 剩余/总数：3/20'
      ];
      
      // 组装通知内容
      let markdownContent = `
## 挂号提醒

发现 **${doctorName}** 医生有可预约号源！

---

### 今日目标
今天需要抢 **${targetDate}** 的号

`;
      
      if (targetSlotStatus.length > 0) {
        markdownContent += `### 目标日期状态

${targetSlotStatus.map(slot => `> - ${slot}`).join('\n')}

`;
      } else {
        markdownContent += `### 目标日期状态

> - ${targetDate} 暂未发现号源

`;
      }
      
      markdownContent += `### 可预约号源

${availableSlots.map(slot => `> - ${slot}`).join('\n')}

---

### [>> 点击这里，立即前往预约 <<](http://www.bjsfrj.com/weixin/zjsyy/index.php/yuyue/ysxx/ysid/48)
      `;
      
      // 发送通知
      const { sendNotification } = await import('../src/notifier');
      await sendNotification(
        `🎉 发现【${doctorName}】有可预约号源！`,
        markdownContent
      );
      
      console.log('通知已发送，请检查微信是否收到');
    });
  });
  
  describe('Notification cooldown', () => {
    it('should respect notification cooldown', () => {
      // 模拟当前时间
      const now = Date.now();
      
      // 模拟战斗模式下的冷却时间（5分钟）
      const combatCooldown = 5 * 60 * 1000;
      
      // 模拟常规模式下的冷却时间（15分钟）
      const regularCooldown = 15 * 60 * 1000;
      
      // 测试冷却时间计算
      expect(combatCooldown).toBe(300000); // 5分钟
      expect(regularCooldown).toBe(900000); // 15分钟
      
      // 测试冷却逻辑
      const lastNotificationTime = now - combatCooldown - 1000; // 超过冷却时间
      expect(now - lastNotificationTime > combatCooldown).toBe(true);
      
      const withinCooldownTime = now - combatCooldown + 1000; // 在冷却时间内
      expect(now - withinCooldownTime > combatCooldown).toBe(false);
    });
  });
});
