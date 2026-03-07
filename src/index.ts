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
      timeout: 60000,
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
        description:
          'List all email accounts configured in Apple Mail. Returns account names and mailbox counts. Use account names from this list when filtering other tools.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'mail_get_mailboxes',
        description:
          'List mailboxes (folders) and their unread counts. Shows all accounts if no account specified. Use mailbox names from this list when filtering other tools.',
        inputSchema: {
          type: 'object',
          properties: {
            account: {
              type: 'string',
              description:
                'Account name to list mailboxes for (e.g. "iCloud"). Lists all accounts if omitted.',
            },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_unread',
        description:
          'Get unread emails from a specific mailbox. Returns message IDs, sender, subject, and date. Use the returned IDs with mail_get_email to read full content.',
        inputSchema: {
          type: 'object',
          properties: {
            account: {
              type: 'string',
              description:
                'Account name to filter by (e.g. "iCloud"). Shows all accounts if omitted.',
            },
            mailbox: {
              type: 'string',
              description: 'Mailbox name (default: INBOX)',
            },
            limit: { type: 'number', description: 'Max emails to return (default: 20)' },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_recent',
        description:
          'Get recent emails (both read and unread) from a specific mailbox. Returns message IDs, sender, subject, date, and read status. Use the returned IDs with mail_get_email to read full content.',
        inputSchema: {
          type: 'object',
          properties: {
            account: {
              type: 'string',
              description:
                'Account name to filter by (e.g. "iCloud"). Shows all accounts if omitted.',
            },
            mailbox: {
              type: 'string',
              description: 'Mailbox name (default: INBOX)',
            },
            limit: { type: 'number', description: 'Max emails to return (default: 20)' },
          },
          required: [],
        },
      },
      {
        name: 'mail_get_email',
        description:
          'Get the full content of a specific email by its numeric ID. Returns sender, date, subject, read status, and complete body text. Use IDs from mail_get_unread, mail_get_recent, or mail_search.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description: 'Numeric message ID returned by listing or search tools (e.g. "12345")',
            },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_search',
        description:
          'Search emails by subject, sender, recipients, or content. Supports filtering by account, mailbox, date range, and field. Returns message IDs that can be used with mail_get_email or mail_get_thread.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Text to search for (matched against fields specified by searchIn)',
            },
            account: {
              type: 'string',
              description:
                'Only search within this account (e.g. "iCloud", "Gmail"). Searches all accounts if omitted.',
            },
            mailbox: {
              type: 'string',
              description:
                'Only search within this mailbox (e.g. "INBOX", "Sent Messages"). Searches all mailboxes if omitted.',
            },
            searchIn: {
              type: 'string',
              enum: ['subject', 'sender', 'recipients', 'content', 'all'],
              description:
                'Which fields to match the query against. "all" searches subject, sender, recipients, and content. Default: subject and sender.',
            },
            dateFrom: {
              type: 'string',
              description: 'Only include emails on or after this date (YYYY-MM-DD format)',
            },
            dateTo: {
              type: 'string',
              description: 'Only include emails on or before this date (YYYY-MM-DD format)',
            },
            limit: { type: 'number', description: 'Max results to return (default: 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'mail_get_thread',
        description:
          'Get all messages in an email conversation thread. Takes a message ID, strips Re:/Fwd: prefixes from its subject, and finds all messages with the same base subject across all mailboxes. Useful for following a full email conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description:
                'Numeric message ID (from search or listing results) of any message in the thread',
            },
            limit: {
              type: 'number',
              description: 'Max messages to return (default: 50)',
            },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_send',
        description: 'Compose and send a new email. Supports To, CC, and BCC recipients.',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Email body content (plain text)' },
            cc: { type: 'string', description: 'CC recipient(s), comma-separated' },
            bcc: { type: 'string', description: 'BCC recipient(s), comma-separated' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
      {
        name: 'mail_reply',
        description:
          'Reply to an existing email by its numeric message ID. Prepends your reply text to the original message and sends it.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description: 'Numeric message ID of the email to reply to',
            },
            body: { type: 'string', description: 'Reply body text' },
            replyAll: {
              type: 'boolean',
              description: 'If true, replies to all recipients (default: false)',
            },
          },
          required: ['emailId', 'body'],
        },
      },
      {
        name: 'mail_mark_read',
        description:
          'Mark one or all emails as read. Pass a numeric message ID for a single email, or "all" with a mailbox and account to mark all messages in that mailbox as read.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description:
                'Numeric message ID, or the string "all" to mark all emails in a mailbox',
            },
            mailbox: {
              type: 'string',
              description: 'Mailbox name (required when emailId is "all")',
            },
            account: {
              type: 'string',
              description: 'Account name (required when emailId is "all")',
            },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_mark_unread',
        description: 'Mark a specific email as unread by its numeric message ID.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Numeric message ID' },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_delete',
        description: 'Move an email to the trash by its numeric message ID.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Numeric message ID' },
          },
          required: ['emailId'],
        },
      },
      {
        name: 'mail_move',
        description:
          'Move an email to a different mailbox. Optionally specify the destination account for cross-account moves.',
        inputSchema: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Numeric message ID' },
            toMailbox: {
              type: 'string',
              description: 'Destination mailbox name (e.g. "Archive", "INBOX")',
            },
            toAccount: {
              type: 'string',
              description: 'Destination account name (for cross-account moves)',
            },
          },
          required: ['emailId', 'toMailbox'],
        },
      },
      {
        name: 'mail_unread_count',
        description:
          'Get unread email counts broken down by account and mailbox. Useful for a quick overview of what needs attention.',
        inputSchema: {
          type: 'object',
          properties: {
            account: {
              type: 'string',
              description: 'Account name to get counts for. Shows all accounts if omitted.',
            },
          },
          required: [],
        },
      },
      {
        name: 'mail_open',
        description: 'Activate and bring the Apple Mail application to the foreground.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'mail_check',
        description: 'Trigger Apple Mail to check for new messages on all accounts.',
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
        set isRead to read status of msg
        return "From: " & msgSender & linefeed & "Date: " & msgDate & linefeed & "Subject: " & msgSubject & linefeed & "Read: " & isRead & linefeed & linefeed & msgContent
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
          searchIn,
          dateFrom,
          dateTo,
          limit = 20,
        } = args as {
          query: string;
          account?: string;
          mailbox?: string;
          searchIn?: 'subject' | 'sender' | 'recipients' | 'content' | 'all';
          dateFrom?: string;
          dateTo?: string;
          limit?: number;
        };
        const safeQuery = escapeAppleScript(query);
        const safeAccount = account ? escapeAppleScript(account) : '';
        const safeMailbox = mailbox ? escapeAppleScript(mailbox) : '';
        const safeDateFrom = dateFrom ? escapeAppleScript(dateFrom) : '';
        const safeDateTo = dateTo ? escapeAppleScript(dateTo) : '';

        // Post-filter to enforce field-specific matching on native search results.
        // Mail's built-in search (Spotlight-backed) finds candidates quickly;
        // we only inspect individual message fields on that small result set.
        let postFilter = '';
        if (searchIn === 'subject') {
          postFilter = `
          try
            if not ((subject of msg as text) contains "${safeQuery}") then set matched to false
          end try`;
        } else if (searchIn === 'sender') {
          postFilter = `
          try
            if not ((sender of msg as text) contains "${safeQuery}") then set matched to false
          end try`;
        } else if (searchIn === 'recipients') {
          postFilter = `
          set matched to false
          try
            repeat with r in to recipients of msg
              if (address of r as text) contains "${safeQuery}" then set matched to true
            end repeat
          end try`;
        } else if (searchIn === 'content') {
          postFilter = `
          try
            if not ((content of msg as text) contains "${safeQuery}") then set matched to false
          end try`;
        } else {
          // Default (no searchIn or 'all'): for 'all' the native search already covers all
          // fields; for default keep historic subject+sender behaviour by post-filtering.
          if (!searchIn) {
            postFilter = `
          set subjectMatch to false
          set senderMatch to false
          try
            if (subject of msg as text) contains "${safeQuery}" then set subjectMatch to true
          end try
          try
            if (sender of msg as text) contains "${safeQuery}" then set senderMatch to true
          end try
          if not (subjectMatch or senderMatch) then set matched to false`;
          }
        }

        let dateChecks = '';
        if (dateFrom) {
          dateChecks += `
          if (date received of msg) < date "${safeDateFrom}" then set matched to false`;
        }
        if (dateTo) {
          dateChecks += `
          if (date received of msg) > date "${safeDateTo}" then set matched to false`;
        }

        const script = `
tell application "Mail"
  set results to ""
  set resultCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${safeAccount}" then` : ''}
    ${
      mailbox
        ? `set mbList to {}
    try
      set end of mbList to mailbox "${safeMailbox}" of acct
    end try`
        : 'set mbList to mailboxes of acct'
    }
    repeat with mb in mbList
      try
        set found to search mb for "${safeQuery}"
        repeat with msg in found
          if resultCount >= ${limit} then exit repeat
          set matched to true${postFilter}${dateChecks}
          if matched then
            set msgId to id of msg
            set msgSubject to subject of msg
            set msgSender to sender of msg
            set msgDate to date received of msg
            set isRead to read status of msg
            set readMarker to ""
            if not isRead then set readMarker to "[UNREAD] "
            set results to results & readMarker & "ID: " & msgId & linefeed
            set results to results & "From: " & msgSender & linefeed
            set results to results & "Subject: " & msgSubject & linefeed
            set results to results & "Date: " & msgDate & linefeed
            set results to results & "Location: " & name of acct & " / " & name of mb & linefeed & linefeed
            set resultCount to resultCount + 1
          end if
        end repeat
      end try
      if resultCount >= ${limit} then exit repeat
    end repeat
    ${account ? 'end if' : ''}
    if resultCount >= ${limit} then exit repeat
  end repeat
  if results is "" then return "No emails found matching: ${safeQuery}"
  return results
end tell`;
        const result = runAppleScript(script);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'mail_get_thread': {
        const { limit = 50 } = args as { emailId: string; limit?: number };
        const emailId = (args as { emailId: string }).emailId;
        const script = `
tell application "Mail"
  set refMsg to missing value
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set refMsg to first message of mb whose id is ${emailId}
        exit repeat
      end try
    end repeat
    if refMsg is not missing value then exit repeat
  end repeat
  if refMsg is missing value then return "Email not found with ID: ${emailId}"

  set baseSubj to subject of refMsg
  repeat
    set changed to false
    if baseSubj starts with "Re: " then
      set baseSubj to text 5 thru -1 of baseSubj
      set changed to true
    end if
    if baseSubj starts with "Fwd: " then
      set baseSubj to text 6 thru -1 of baseSubj
      set changed to true
    end if
    if not changed then exit repeat
  end repeat

  set results to ""
  set resultCount to 0
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        repeat with msg in messages of mb
          if resultCount < ${limit} then
            set msgSubj to subject of msg
            repeat
              set changed to false
              if msgSubj starts with "Re: " then
                set msgSubj to text 5 thru -1 of msgSubj
                set changed to true
              end if
              if msgSubj starts with "Fwd: " then
                set msgSubj to text 6 thru -1 of msgSubj
                set changed to true
              end if
              if not changed then exit repeat
            end repeat
            if msgSubj is baseSubj then
              set msgId to id of msg
              set msgSender to sender of msg
              set msgDate to date received of msg
              set isRead to read status of msg
              set readMarker to ""
              if not isRead then set readMarker to "[UNREAD] "
              set results to results & readMarker & "ID: " & msgId & linefeed
              set results to results & "From: " & msgSender & linefeed
              set results to results & "Subject: " & (subject of msg) & linefeed
              set results to results & "Date: " & msgDate & linefeed
              set results to results & "Location: " & name of acct & " / " & name of mb & linefeed & linefeed
              set resultCount to resultCount + 1
            end if
          end if
        end repeat
      end try
    end repeat
  end repeat
  if results is "" then return "No thread messages found"
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
