#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

// Escape a string for safe interpolation inside an AppleScript double-quoted string.
// Backslashes must be escaped before quotes to avoid double-processing.
export function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const server = new Server(
  {
    name: 'apple-mail-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper function to run AppleScript
// Note: Using execSync with osascript is required for AppleScript execution
// Scripts are written to temp files to avoid shell escaping issues
function runAppleScript(script: string): string {
  try {
    const tempFile = `/tmp/mail-mcp-${randomUUID()}.scpt`;
    execSync(`cat > '${tempFile}' << 'APPLESCRIPT_EOF'
${script}
APPLESCRIPT_EOF`);
    const result = execSync(`osascript '${tempFile}'`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
    execSync(`rm -f '${tempFile}'`);
    return result;
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; stdout?: string };
    throw new Error(`AppleScript error: ${err.stderr || err.message}`);
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mail_get_accounts',
        description: 'Get all email accounts configured in Apple Mail',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'mail_get_mailboxes',
        description: 'Get all mailboxes for an account',
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account name (optional)' },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_unread',
        description: 'Get unread emails',
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account name (optional)' },
            mailbox: { type: 'string', description: 'Mailbox name (default: INBOX)' },
            limit: { type: 'number', description: 'Max emails (default: 20)' },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_recent',
        description: 'Get recent emails (read and unread)',
        inputSchema: {
          type: 'object',
          properties: {
            account: { type: 'string', description: 'Account name (optional)' },
            mailbox: { type: 'string', description: 'Mailbox name (default: INBOX)' },
            limit: { type: 'number', description: 'Max emails (default: 20)' },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_email',
        description: 'Get full content of a specific email by ID',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Email message ID' },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_search',
        description: 'Search emails by subject, sender, or content',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            account: { type: 'string', description: 'Account name (optional)' },
            mailbox: {
              type: 'string',
              description: 'Mailbox name (optional, searches all mailboxes if omitted)',
            },
            searchIn: {
              type: 'string',
              enum: ['subject', 'sender', 'content', 'all'],
              description: 'Where to search (default: all)',
            },
            limit: { type: 'number', description: 'Max results (default: 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'mail_send',
        description: 'Send a new email',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email' },
            subject: { type: 'string', description: 'Subject' },
            body: { type: 'string', description: 'Body content' },
            cc: { type: 'string', description: 'CC (comma-separated)' },
            bcc: { type: 'string', description: 'BCC (comma-separated)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'mail_reply',
        description: 'Reply to an email',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Email ID to reply to' },
            body: { type: 'string', description: 'Reply content' },
            replyAll: { type: 'boolean', description: 'Reply all (default: false)' },
          },
          required: ['emailId', 'body'],
        },
      },
      {
        name: 'mail_mark_read',
        description: 'Mark email(s) as read',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: "Email ID or 'all'" },
            mailbox: { type: 'string', description: "Mailbox (if 'all')" },
            account: { type: 'string', description: "Account (if 'all')" },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_mark_unread',
        description: 'Mark email as unread',
        inputSchema: {
          type: 'object',
          properties: { emailId: { type: 'string', description: 'Email ID' } },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_delete',
        description: 'Delete an email (move to trash)',
        inputSchema: {
          type: 'object',
          properties: { emailId: { type: 'string', description: 'Email ID' } },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_move',
        description: 'Move email to a different mailbox',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Email ID' },
            toMailbox: { type: 'string', description: 'Destination mailbox' },
            toAccount: { type: 'string', description: 'Destination account (optional)' },
          },
          required: ['emailId', 'toMailbox'],
        },
      },
      {
        name: 'mail_unread_count',
        description: 'Get count of unread emails per account/mailbox',
        inputSchema: {
          type: 'object',
          properties: { account: { type: 'string', description: 'Account (optional)' } },
          required: [],
        },
      },
      {
        name: 'mail_open',
        description: 'Open the Mail app',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'mail_check',
        description: 'Check for new mail',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'mail_get_accounts': {
        const script = `
tell application "Mail"
  set accountList to ""
  repeat with acct in accounts
    set accountList to accountList & name of acct & " (" & (count of mailboxes of acct) & " mailboxes)" & linefeed
  end repeat
  if accountList is "" then return "No email accounts found"
  return accountList
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: `Email Accounts:\n${result}` }] };
      }

      case 'mail_get_mailboxes': {
        const account = (args as { account?: string }).account;
        const safeAccount = account ? escapeAppleScript(account) : '';
        const script = account
          ? `
tell application "Mail"
  try
    set acct to account "${safeAccount}"
    set mbList to ""
    repeat with mb in mailboxes of acct
      set unreadCount to unread count of mb
      set mbList to mbList & name of mb & " (" & unreadCount & " unread)" & linefeed
    end repeat
    if mbList is "" then return "No mailboxes found"
    return mbList
  on error
    return "Account not found: ${safeAccount}"
  end try
end tell`
          : `
tell application "Mail"
  set mbList to ""
  repeat with acct in accounts
    set mbList to mbList & "=== " & name of acct & " ===" & linefeed
    repeat with mb in mailboxes of acct
      set unreadCount to unread count of mb
      set mbList to mbList & "  " & name of mb & " (" & unreadCount & " unread)" & linefeed
    end repeat
  end repeat
  return mbList
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_get_unread': {
        const {
          account,
          mailbox = 'INBOX',
          limit = 20,
        } = args as { account?: string; mailbox?: string; limit?: number };
        const safeAccount = account ? escapeAppleScript(account) : '';
        const safeMailbox = escapeAppleScript(mailbox);
        const script = `
tell application "Mail"
  set emailList to ""
  set emailCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${safeAccount}" then` : ''}
    try
      set mb to mailbox "${safeMailbox}" of acct
      repeat with msg in (messages of mb whose read status is false)
        if emailCount < ${limit} then
          set msgId to id of msg
          set msgSubject to subject of msg
          set msgSender to sender of msg
          set msgDate to date received of msg
          set emailList to emailList & "[" & name of acct & "]" & linefeed
          set emailList to emailList & "ID: " & msgId & linefeed
          set emailList to emailList & "From: " & msgSender & linefeed
          set emailList to emailList & "Subject: " & msgSubject & linefeed
          set emailList to emailList & "Date: " & msgDate & linefeed & linefeed
          set emailCount to emailCount + 1
        end if
      end repeat
    end try
    ${account ? 'end if' : ''}
  end repeat
  if emailList is "" then return "No unread emails found"
  return emailList
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_get_recent': {
        const {
          account,
          mailbox = 'INBOX',
          limit = 20,
        } = args as { account?: string; mailbox?: string; limit?: number };
        const safeAccount = account ? escapeAppleScript(account) : '';
        const safeMailbox = escapeAppleScript(mailbox);
        const script = `
tell application "Mail"
  set emailList to ""
  set emailCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${safeAccount}" then` : ''}
    try
      set mb to mailbox "${safeMailbox}" of acct
      repeat with msg in messages of mb
        if emailCount < ${limit} then
          set msgId to id of msg
          set msgSubject to subject of msg
          set msgSender to sender of msg
          set msgDate to date received of msg
          set isRead to read status of msg
          set readMarker to ""
          if not isRead then set readMarker to "[UNREAD] "
          set emailList to emailList & readMarker & "[" & name of acct & "]" & linefeed
          set emailList to emailList & "ID: " & msgId & linefeed
          set emailList to emailList & "From: " & msgSender & linefeed
          set emailList to emailList & "Subject: " & msgSubject & linefeed
          set emailList to emailList & "Date: " & msgDate & linefeed & linefeed
          set emailCount to emailCount + 1
        end if
      end repeat
    end try
    ${account ? 'end if' : ''}
  end repeat
  if emailList is "" then return "No emails found"
  return emailList
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_get_email': {
        const emailId = (args as { emailId: string }).emailId;
        const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        set msgContent to content of msg
        set msgSubject to subject of msg
        set msgSender to sender of msg
        set msgDate to date received of msg
        return "From: " & msgSender & linefeed & "Date: " & msgDate & linefeed & "Subject: " & msgSubject & linefeed & linefeed & msgContent
      end try
    end repeat
  end repeat
  return "Email not found with ID: ${emailId}"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_search': {
        const {
          query,
          account,
          mailbox,
          searchIn = 'all',
          limit = 20,
        } = args as {
          query: string;
          account?: string;
          mailbox?: string;
          searchIn?: string;
          limit?: number;
        };
        const safeQuery = escapeAppleScript(query);
        const safeAccount = account ? escapeAppleScript(account) : '';
        const safeMailbox = mailbox ? escapeAppleScript(mailbox) : '';

        const matchSubject = searchIn === 'all' || searchIn === 'subject';
        const matchSender = searchIn === 'all' || searchIn === 'sender';
        const matchContent = searchIn === 'all' || searchIn === 'content';

        const subjectCheck = matchSubject
          ? `try
              if (subject of msg as text) contains "${safeQuery}" then set matched to true
            end try`
          : '';
        const senderCheck = matchSender
          ? `try
              if (sender of msg as text) contains "${safeQuery}" then set matched to true
            end try`
          : '';
        const contentCheck = matchContent
          ? `try
              if (content of msg as text) contains "${safeQuery}" then set matched to true
            end try`
          : '';

        const script = `
tell application "Mail"
  set results to ""
  set resultCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${safeAccount}" then` : ''}
    ${
      mailbox
        ? `try
      set mbList to {mailbox "${safeMailbox}" of acct}
    end try`
        : 'set mbList to mailboxes of acct'
    }
    repeat with mb in mbList
      try
        repeat with msg in messages of mb
          if resultCount < ${limit} then
            set matched to false
            ${subjectCheck}
            ${senderCheck}
            ${contentCheck}
            if matched then
              set msgId to id of msg
              set msgSubject to subject of msg
              set msgSender to sender of msg
              set msgDate to date received of msg
              set results to results & "ID: " & msgId & linefeed
              set results to results & "From: " & msgSender & linefeed
              set results to results & "Subject: " & msgSubject & linefeed
              set results to results & "Date: " & msgDate & linefeed
              set results to results & "Location: " & name of acct & " / " & name of mb & linefeed & linefeed
              set resultCount to resultCount + 1
            end if
          end if
        end repeat
      end try
    end repeat
    ${account ? 'end if' : ''}
  end repeat
  if results is "" then return "No emails found matching: ${safeQuery}"
  return results
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_send': {
        const { to, subject, body, cc, bcc } = args as {
          to: string;
          subject: string;
          body: string;
          cc?: string;
          bcc?: string;
        };
        const safeTo = escapeAppleScript(to);
        const safeSubject = escapeAppleScript(subject);
        const safeBody = escapeAppleScript(body);
        const safeCc = cc ? escapeAppleScript(cc) : '';
        const safeBcc = bcc ? escapeAppleScript(bcc) : '';
        const script = `
tell application "Mail"
  set newMessage to make new outgoing message with properties {subject:"${safeSubject}", content:"${safeBody}", visible:true}
  tell newMessage
    make new to recipient at end of to recipients with properties {address:"${safeTo}"}
    ${cc ? `make new cc recipient at end of cc recipients with properties {address:"${safeCc}"}` : ''}
    ${bcc ? `make new bcc recipient at end of bcc recipients with properties {address:"${safeBcc}"}` : ''}
  end tell
  send newMessage
  return "Email sent to ${safeTo}"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_reply': {
        const {
          emailId,
          body,
          replyAll = false,
        } = args as { emailId: string; body: string; replyAll?: boolean };
        const safeBody = escapeAppleScript(body);
        const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        set replyMsg to reply msg with opening window${replyAll ? ' and reply to all' : ''}
        set content of replyMsg to "${safeBody}" & return & return & content of replyMsg
        send replyMsg
        return "Reply sent"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_mark_read': {
        const { emailId, mailbox, account } = args as {
          emailId: string;
          mailbox?: string;
          account?: string;
        };
        if (emailId === 'all' && mailbox && account) {
          const safeAccount = escapeAppleScript(account);
          const safeMailbox = escapeAppleScript(mailbox);
          const script = `
tell application "Mail"
  try
    set acct to account "${safeAccount}"
    set mb to mailbox "${safeMailbox}" of acct
    set read status of (messages of mb whose read status is false) to true
    return "Marked all emails as read in ${safeMailbox}"
  on error errMsg
    return "Error: " & errMsg
  end try
end tell`;
          const result = runAppleScript(script);
          return { content: [{ type: 'text', text: result }] };
        } else {
          const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        set read status of msg to true
        return "Marked as read"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
          const result = runAppleScript(script);
          return { content: [{ type: 'text', text: result }] };
        }
      }

      case 'mail_mark_unread': {
        const emailId = (args as { emailId: string }).emailId;
        const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        set read status of msg to false
        return "Marked as unread"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_delete': {
        const emailId = (args as { emailId: string }).emailId;
        const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        delete msg
        return "Email deleted"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_move': {
        const { emailId, toMailbox, toAccount } = args as {
          emailId: string;
          toMailbox: string;
          toAccount?: string;
        };
        const safeToMailbox = escapeAppleScript(toMailbox);
        const safeToAccount = toAccount ? escapeAppleScript(toAccount) : '';
        const script = `
tell application "Mail"
  set destMb to missing value
  repeat with acct in accounts
    ${toAccount ? `if name of acct is "${safeToAccount}" then` : ''}
    try
      set destMb to mailbox "${safeToMailbox}" of acct
      ${toAccount ? '' : 'exit repeat'}
    end try
    ${toAccount ? 'end if' : ''}
  end repeat
  if destMb is missing value then return "Mailbox not found: ${safeToMailbox}"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        move msg to destMb
        return "Email moved to ${safeToMailbox}"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_unread_count': {
        const account = (args as { account?: string }).account;
        const safeAccount = account ? escapeAppleScript(account) : '';
        const script = `
tell application "Mail"
  set countList to ""
  set grandTotal to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${safeAccount}" then` : ''}
    set acctTotal to 0
    set acctList to ""
    repeat with mb in mailboxes of acct
      set unreadCount to unread count of mb
      if unreadCount > 0 then
        set acctList to acctList & "  " & name of mb & ": " & unreadCount & linefeed
        set acctTotal to acctTotal + unreadCount
      end if
    end repeat
    if acctTotal > 0 then
      set countList to countList & name of acct & " (" & acctTotal & " unread):" & linefeed & acctList & linefeed
      set grandTotal to grandTotal + acctTotal
    end if
    ${account ? 'end if' : ''}
  end repeat
  if countList is "" then return "No unread emails"
  return countList & "Grand Total: " & grandTotal & " unread"
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_open': {
        runAppleScript('tell application "Mail" to activate');
        return { content: [{ type: 'text', text: 'Mail app opened' }] };
      }

      case 'mail_check': {
        runAppleScript('tell application "Mail" to check for new mail');
        return { content: [{ type: 'text', text: 'Checking for new mail...' }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [
        { type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Apple Mail MCP server running on stdio');
}

main().catch(console.error);
