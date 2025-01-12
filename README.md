# XyloSync - Secure File Sharing Portal

## Overview
XyloSync is a streamlined file sharing platform designed for educational environments, focusing on secure and efficient file distribution. It addresses the common challenges in academic settings by providing a controlled environment with tiered access controls, eliminating the need for personal account logins on shared devices.

## Purpose
Created to solve a common classroom problem: the hassle of sharing files during sessions. Instead of using personal accounts on public devices, XyloSync offers a straightforward way to share files while maintaining basic security through access controls.

## Core Features

### Access Control
- **Three-Tier System**: Different access levels for viewing, uploading, and managing files
- **Session Management**: Automatic timeout for better security
- **Simple Access**: Password-based entry without account creation

### File Handling
- **File Uploads**: Support for files up to 4.5MB
- **Drag-and-Drop**: Easy file upload interface
- **Cloud Storage**: Supabase Storage for reliability
- **Status Updates**: Socket.IO for file status tracking

### XyloMail
A supplementary email feature:
- **Dual Providers**: Different email services based on access level
- **Multiple Recipients**: Send files to up to 5 emails
- **File Packaging**: Automatic ZIP compression

### Mobile Access
- **Responsive Layout**: Works on different screen sizes
- **Cross-Platform**: Basic support for iOS and Android

### Admin Panel
- **Maintenance Control**: Toggle system availability
- **Feature Management**: Enable/disable specific functions
- **File Control**: Bulk file management options

## Technology Used
- **Frontend**: HTML5, CSS3, JavaScript
- **Backend**: Node.js, Express.js
- **Storage**: Supabase Storage
- **Real-Time**: Socket.IO
- **Email**: Brevo API & SMTP2GO
- **IDE**: Built with Cursor AI

## Common Uses
- Sharing lecture materials
- Quick file distribution in classrooms
- Local network file sharing
- Temporary file hosting with email copies

## Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/xylosync.git
```
```bash
cd xylosync
```
2. Install dependencies
```bash
npm install
```
3. Create environment file
```bash
cp .env.example .env
```
Fill in the credentials in the `.env` file for:
- Firebase configuration
- Email service providers (SMTP2GO and Brevo)
- Access level passwords (Level 1: View, Level 2: Upload, Level 3: Admin)

4. Run the server
```bash
npm start
```
Server runs at `http://localhost:3000`