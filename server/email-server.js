import express from 'express';
import multer from 'multer';
import archiver from 'archiver';
import { Readable } from 'stream';
import nodemailer from 'nodemailer';
import SibApiV3Sdk from 'sib-api-v3-sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Verify required environment variables
const requiredEnvVars = [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM_EMAIL',
    'SMTP_FROM_NAME',
    'BREVO_API_KEY',
    'BREVO_SENDER_EMAIL',
    'BREVO_SENDER_NAME'
];

requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }
});

// Configure Brevo API properly
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// SMTP2GO Configuration as fallback
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

export const emailServerHandler = async (req, res) => {
    try {
        const { message } = req.body;
        const files = req.files;

        // Parse the emails array from the JSON string
        let emailList;
        try {
            emailList = JSON.parse(req.body.emails);
        } catch (error) {
            // Fallback for single email
            emailList = [req.body.email];
        }

        if (!emailList || emailList.length === 0 || !files || files.length === 0) {
            return res.status(400).json({ error: 'Email(s) and files are required.' });
        }

        if (emailList.length > 5) {
            return res.status(400).json({ error: 'Maximum 5 recipients allowed.' });
        }

        console.log('Preparing to send email to:', emailList);
        console.log('Number of files:', files.length);

        // Create zip buffer in memory
        const archive = archiver('zip', { store: true });
        const chunks = [];
        
        archive.on('data', chunk => chunks.push(chunk));

        // Create a promise for zip creation
        const zipPromise = new Promise((resolve, reject) => {
            archive.on('end', () => {
                const zipBuffer = Buffer.concat(chunks);
                resolve(zipBuffer);
            });
            archive.on('error', reject);
        });

        // Add files to archive
        files.forEach(file => {
            const stream = new Readable();
            stream.push(file.buffer);
            stream.push(null);
            archive.append(stream, { name: file.originalname });
        });

        // Finalize archive
        await archive.finalize();

        // Wait for zip creation to complete
        const zipBuffer = await zipPromise;
        const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '-');
        const zipFileName = `XyloMail_Files_${timestamp}.zip`;

        // Prepare email template
        const htmlTemplate = prepareEmailTemplate(files.length, message);

        // Send emails in parallel
        const sendEmailPromises = emailList.map(async (recipientEmail) => {
            try {
                // Try Brevo first
                try {
                    console.log('Attempting to send via Brevo with API key:', process.env.BREVO_API_KEY ? 'Present' : 'Missing');
                    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
                    
                    sendSmtpEmail.sender = {
                        name: process.env.BREVO_SENDER_NAME,
                        email: process.env.BREVO_SENDER_EMAIL
                    };
                    sendSmtpEmail.to = [{ email: recipientEmail }];
                    sendSmtpEmail.subject = "Your Files Are Ready";
                    sendSmtpEmail.htmlContent = htmlTemplate;
                    sendSmtpEmail.attachment = [{
                        name: zipFileName,
                        content: zipBuffer.toString('base64')
                    }];

                    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
                    console.log(`Email sent via Brevo to ${recipientEmail}`);
                    return { success: true, email: recipientEmail, messageId: data.messageId };
                } catch (brevoError) {
                    console.error('Brevo error details:', brevoError);
                    console.log(`Brevo send failed, falling back to SMTP2Go for ${recipientEmail}`);
                    
                    // Fallback to SMTP2Go
                    const mailOptions = {
                        from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
                        to: recipientEmail,
                        subject: 'Your Files Are Ready',
                        html: htmlTemplate,
                        attachments: [{ filename: zipFileName, content: zipBuffer }]
                    };

                    const info = await transporter.sendMail(mailOptions);
                    console.log(`Email sent via SMTP2Go fallback to ${recipientEmail}`);
                    return { success: true, email: recipientEmail, messageId: info.messageId };
                }
            } catch (error) {
                console.error(`Failed to send email to ${recipientEmail} via both services:`, error);
                return { success: false, email: recipientEmail, error: error.message };
            }
        });

        // Wait for all emails to be sent
        const results = await Promise.all(sendEmailPromises);
        const successCount = results.filter(r => r.success).length;
        const failureCount = emailList.length - successCount;

        if (successCount === 0) {
            res.status(500).json({ error: 'Failed to send all emails' });
        } else if (failureCount > 0) {
            res.json({ 
                partialSuccess: true,
                message: `Successfully sent to ${successCount} out of ${emailList.length} recipients`
            });
        } else {
            res.json({ success: true, message: `Successfully sent to all ${successCount} recipients` });
        }
    } catch (error) {
        console.error('Request Error:', error);
        res.status(500).json({ 
            error: 'Server error occurred',
            details: error.message 
        });
    }
};

// Helper function to prepare email template
function prepareEmailTemplate(fileCount, message) {
    const currentDate = new Date().toLocaleDateString();
    const gradientColors = 'linear-gradient(135deg, #6366f1, #141249)';
    const accentColor = '#6366f1';

    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Files Are Ready</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #ffffff; color: #333333;">
            <div style="max-width: 600px; margin: 20px auto; padding: 0; text-align: center; background-color: #ffffff; border-radius: 10px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);">
                <div style="background: ${gradientColors}; color: #ffffff; padding: 20px; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">Your Files Have Been Delivered</h1>
                </div>
                <div style="background-color: #121212; color: #ffffff; padding: 25px; text-align: left; border-radius: 0 0 10px 10px;">
                    <h2 style="font-size: 20px; color: ${accentColor};">Dear Recipient,</h2>
                    <p style="margin: 0 0 15px; color: #ffffff;">
                        The files you requested through <strong style="color: ${accentColor};">XyloMail</strong> have been successfully processed and are attached to this email.
                    </p>
                    <div style="background-color: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 5px 0; color: #cccccc;"><strong>Date Processed:</strong> ${currentDate}</p>
                        <p style="margin: 5px 0; color: #cccccc;"><strong>Number of Files:</strong> ${fileCount}</p>
                        <p style="margin: 5px 0; color: #cccccc;"><strong>File Package:</strong> Delivered as a single ZIP archive.</p>
                    </div>
                    <p style="margin-bottom: 5px; color: ${accentColor};">Message from the sender:</p>
                    <blockquote style="font-style: italic; color: #dddddd; border-left: 4px solid ${accentColor}; padding-left: 10px; margin: 10px 0;">
                        ${message ? message : "No message has been provided."}
                    </blockquote>
                    <p style="margin: 15px 0; font-size: 14px; color: #cccccc;">
                        Thank you for choosing <strong style="color: ${accentColor};">XyloMail</strong>. We aim to make your file transfers simple, secure, and seamless.
                    </p>
                    <p style="color: #cccccc;">If you need further assistance, feel free to reply to this email or reach out to our support team.</p>
                    <div style="margin-top: 20px; text-align: center; font-size: 12px; color: #cccccc;">
                        <p style="margin: 0;">&copy; 2025 <strong style="color: ${accentColor};">XyloSync</strong>. All rights reserved.</p>
                        <p style="margin: 0;">Secure file sharing, powered by <strong style="color: ${accentColor};">XyloSync</strong>.</p>
                </div>
                </div>
            </div>
        </body>
        </html>
    `;
}
