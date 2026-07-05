// Email (SMTP): αποστολή email με συνημμένα και δοκιμή σύνδεσης SMTP.
import { ipcMain } from 'electron';
import nodemailer from 'nodemailer';

ipcMain.handle('send-email', async (event, smtpConfig, emailData) => {
  try {
    const transporter = nodemailer.createTransport({
      host:   smtpConfig.host,
      port:   parseInt(smtpConfig.port) || 587,
      secure: smtpConfig.port == 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });

    await transporter.sendMail({
      from:        smtpConfig.from || smtpConfig.user,
      to:          emailData.to,
      subject:     emailData.subject,
      text:        emailData.body || '',
      attachments: emailData.attachments || [],
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('test-smtp', async (event, smtpConfig) => {
  try {
    const transporter = nodemailer.createTransport({
      host:   smtpConfig.host,
      port:   parseInt(smtpConfig.port) || 587,
      secure: smtpConfig.port == 465,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });
    await transporter.verify();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
