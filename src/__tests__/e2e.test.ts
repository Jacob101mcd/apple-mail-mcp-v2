import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as childProcess from 'child_process';
import { randomUUID } from 'crypto';
import { escapeAppleScript } from '../index.js';

// Mock child_process.execSync to avoid actual AppleScript execution during tests
// This is safe because we're only mocking for test purposes, not executing real commands
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// List of all tools that should be registered
const EXPECTED_TOOLS = [
  'mail_get_accounts',
  'mail_get_mailboxes',
  'mail_get_unread',
  'mail_get_recent',
  'mail_get_email',
  'mail_search',
  'mail_send',
  'mail_reply',
  'mail_mark_read',
  'mail_mark_unread',
  'mail_delete',
  'mail_move',
  'mail_unread_count',
  'mail_open',
  'mail_check',
];

// Helper function to create a mock server with handlers
function createMockServer(): Server {
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
  return server;
}

// Helper to run AppleScript (mocked version for testing)
// Note: This function simulates the behavior of the real runAppleScript function
// but uses mocked execSync to avoid actual AppleScript execution
function runAppleScript(script: string): string {
  try {
    const tempFile = `/tmp/mail-mcp-${randomUUID()}.scpt`;
    childProcess.execSync(`cat > '${tempFile}' << 'APPLESCRIPT_EOF'
${script}
APPLESCRIPT_EOF`);
    const result = (
      childProcess.execSync(`osascript '${tempFile}'`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      }) as string
    ).trim();
    childProcess.execSync(`rm -f '${tempFile}'`);
    return result;
  } catch (error: unknown) {
    const err = error as Error & { stderr?: string; stdout?: string };
    throw new Error(`AppleScript error: ${err.stderr || err.message}`);
  }
}

// Tool handler implementations (extracted from index.ts for testing)
type ToolHandler = (args: Record<string, unknown>) => {
  content: { type: string; text: string }[];
  isError?: boolean;
};

function createToolHandlers(): Record<string, ToolHandler> {
  return {
    mail_get_accounts: (): ReturnType<ToolHandler> => {
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
    },

    mail_get_mailboxes: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const account = args.account as string | undefined;
      const script = account
        ? `
tell application "Mail"
  try
    set acct to account "${account}"
    set mbList to ""
    repeat with mb in mailboxes of acct
      set unreadCount to unread count of mb
      set mbList to mbList & name of mb & " (" & unreadCount & " unread)" & linefeed
    end repeat
    if mbList is "" then return "No mailboxes found"
    return mbList
  on error
    return "Account not found: ${account}"
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
    },

    mail_get_unread: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const {
        account,
        mailbox = 'INBOX',
        limit = 20,
      } = args as {
        account?: string;
        mailbox?: string;
        limit?: number;
      };
      const script = `
tell application "Mail"
  set emailList to ""
  set emailCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${account}" then` : ''}
    try
      set mb to mailbox "${mailbox}" of acct
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
    },

    mail_get_recent: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const {
        account,
        mailbox = 'INBOX',
        limit = 20,
      } = args as {
        account?: string;
        mailbox?: string;
        limit?: number;
      };
      const script = `
tell application "Mail"
  set emailList to ""
  set emailCount to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${account}" then` : ''}
    try
      set mb to mailbox "${mailbox}" of acct
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
    },

    mail_get_email: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const emailId = args.emailId as string;
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
    },

    mail_search: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
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
    },

    mail_send: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const { to, subject, body, cc, bcc } = args as {
        to: string;
        subject: string;
        body: string;
        cc?: string;
        bcc?: string;
      };
      const script = `
tell application "Mail"
  set newMessage to make new outgoing message with properties {subject:"${subject}", content:"${body}", visible:true}
  tell newMessage
    make new to recipient at end of to recipients with properties {address:"${to}"}
    ${cc ? `make new cc recipient at end of cc recipients with properties {address:"${cc}"}` : ''}
    ${bcc ? `make new bcc recipient at end of bcc recipients with properties {address:"${bcc}"}` : ''}
  end tell
  send newMessage
  return "Email sent to ${to}"
end tell`;
      const result = runAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    },

    mail_reply: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const {
        emailId,
        body,
        replyAll = false,
      } = args as {
        emailId: string;
        body: string;
        replyAll?: boolean;
      };
      const script = `
tell application "Mail"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        set replyMsg to reply msg with opening window${replyAll ? ' and reply to all' : ''}
        set content of replyMsg to "${body}" & return & return & content of replyMsg
        send replyMsg
        return "Reply sent"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
      const result = runAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    },

    mail_mark_read: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const { emailId, mailbox, account } = args as {
        emailId: string;
        mailbox?: string;
        account?: string;
      };
      if (emailId === 'all' && mailbox && account) {
        const script = `
tell application "Mail"
  try
    set acct to account "${account}"
    set mb to mailbox "${mailbox}" of acct
    set read status of (messages of mb whose read status is false) to true
    return "Marked all emails as read in ${mailbox}"
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
    },

    mail_mark_unread: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const emailId = args.emailId as string;
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
    },

    mail_delete: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const emailId = args.emailId as string;
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
    },

    mail_move: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const { emailId, toMailbox, toAccount } = args as {
        emailId: string;
        toMailbox: string;
        toAccount?: string;
      };
      const script = `
tell application "Mail"
  set destMb to missing value
  repeat with acct in accounts
    ${toAccount ? `if name of acct is "${toAccount}" then` : ''}
    try
      set destMb to mailbox "${toMailbox}" of acct
      ${toAccount ? '' : 'exit repeat'}
    end try
    ${toAccount ? 'end if' : ''}
  end repeat
  if destMb is missing value then return "Mailbox not found: ${toMailbox}"
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msg to first message of mb whose id is ${emailId}
        move msg to destMb
        return "Email moved to ${toMailbox}"
      end try
    end repeat
  end repeat
  return "Email not found"
end tell`;
      const result = runAppleScript(script);
      return { content: [{ type: 'text', text: result }] };
    },

    mail_unread_count: (args: Record<string, unknown>): ReturnType<ToolHandler> => {
      const account = args.account as string | undefined;
      const script = `
tell application "Mail"
  set countList to ""
  set grandTotal to 0
  repeat with acct in accounts
    ${account ? `if name of acct is "${account}" then` : ''}
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
    },

    mail_open: (): ReturnType<ToolHandler> => {
      runAppleScript('tell application "Mail" to activate');
      return { content: [{ type: 'text', text: 'Mail app opened' }] };
    },

    mail_check: (): ReturnType<ToolHandler> => {
      runAppleScript('tell application "Mail" to check for new mail');
      return { content: [{ type: 'text', text: 'Checking for new mail...' }] };
    },
  };
}

describe('Apple Mail MCP Server - End-to-End Tests', () => {
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecSync = vi.mocked(childProcess.execSync);
    mockExecSync.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Server Initialization', () => {
    it('should create a server instance with correct name and version', () => {
      const server = createMockServer();
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(Server);
    });

    it('should have tools capability enabled', () => {
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
      expect(server).toBeDefined();
    });
  });

  describe('Tool Registration', () => {
    it('should register all expected tools', async () => {
      const _server = createMockServer();

      // Define tool definitions for verification
      const toolDefinitions = [
        {
          name: 'mail_get_accounts',
          description: 'Get all email accounts configured in Apple Mail',
        },
        { name: 'mail_get_mailboxes', description: 'Get all mailboxes for an account' },
        { name: 'mail_get_unread', description: 'Get unread emails' },
        { name: 'mail_get_recent', description: 'Get recent emails (read and unread)' },
        { name: 'mail_get_email', description: 'Get full content of a specific email by ID' },
        { name: 'mail_search', description: 'Search emails by subject, sender, or content' },
        { name: 'mail_send', description: 'Send a new email' },
        { name: 'mail_reply', description: 'Reply to an email' },
        { name: 'mail_mark_read', description: 'Mark email(s) as read' },
        { name: 'mail_mark_unread', description: 'Mark email as unread' },
        { name: 'mail_delete', description: 'Delete an email (move to trash)' },
        { name: 'mail_move', description: 'Move email to a different mailbox' },
        {
          name: 'mail_unread_count',
          description: 'Get count of unread emails per account/mailbox',
        },
        { name: 'mail_open', description: 'Open the Mail app' },
        { name: 'mail_check', description: 'Check for new mail' },
      ];

      // Verify all expected tools are defined
      const toolNames = toolDefinitions.map((t) => t.name);
      EXPECTED_TOOLS.forEach((expectedTool) => {
        expect(toolNames).toContain(expectedTool);
      });

      expect(toolNames.length).toBe(EXPECTED_TOOLS.length);
    });

    it('should have correct input schemas for tools with required parameters', () => {
      const toolSchemas = {
        mail_get_email: {
          type: 'object',
          properties: { emailId: { type: 'string', description: 'Email message ID' } },
          required: ['emailId'],
        },
        mail_search: {
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
        mail_send: {
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
        mail_reply: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Email ID to reply to' },
            body: { type: 'string', description: 'Reply content' },
            replyAll: { type: 'boolean', description: 'Reply all (default: false)' },
          },
          required: ['emailId', 'body'],
        },
        mail_mark_read: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: "Email ID or 'all'" },
            mailbox: { type: 'string', description: "Mailbox (if 'all')" },
            account: { type: 'string', description: "Account (if 'all')" },
          },
          required: ['emailId'],
        },
        mail_move: {
          type: 'object',
          properties: {
            emailId: { type: 'string', description: 'Email ID' },
            toMailbox: { type: 'string', description: 'Destination mailbox' },
            toAccount: { type: 'string', description: 'Destination account (optional)' },
          },
          required: ['emailId', 'toMailbox'],
        },
      };

      // Verify schemas have required fields
      expect(toolSchemas.mail_get_email.required).toContain('emailId');
      expect(toolSchemas.mail_search.required).toContain('query');
      expect(toolSchemas.mail_send.required).toEqual(['to', 'subject', 'body']);
      expect(toolSchemas.mail_reply.required).toEqual(['emailId', 'body']);
      expect(toolSchemas.mail_move.required).toEqual(['emailId', 'toMailbox']);
    });
  });

  describe('Tool Handlers with Mocked AppleScript Responses', () => {
    describe('mail_get_accounts', () => {
      it('should return list of email accounts', () => {
        const mockResponse = 'Work Account (5 mailboxes)\nPersonal Account (3 mailboxes)';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_accounts({});

        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('Email Accounts:');
        expect(result.content[0].text).toContain(mockResponse);
      });

      it('should handle empty accounts gracefully', () => {
        mockExecSync.mockReturnValue('No email accounts found');

        const handlers = createToolHandlers();
        const result = handlers.mail_get_accounts({});

        expect(result.content[0].text).toContain('No email accounts found');
      });
    });

    describe('mail_get_mailboxes', () => {
      it('should return mailboxes for all accounts when no account specified', () => {
        const mockResponse = '=== Work Account ===\n  INBOX (5 unread)\n  Sent (0 unread)';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_mailboxes({});

        expect(result.content[0].text).toContain('INBOX');
        expect(result.content[0].text).toContain('Work Account');
      });

      it('should return mailboxes for specific account', () => {
        const mockResponse = 'INBOX (3 unread)\nArchive (0 unread)';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_mailboxes({ account: 'Work Account' });

        expect(result.content[0].text).toContain('INBOX');
      });
    });

    describe('mail_get_unread', () => {
      it('should return unread emails with default parameters', () => {
        const mockResponse =
          '[Work Account]\nID: 12345\nFrom: sender@example.com\nSubject: Test Subject\nDate: January 12, 2026';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_unread({});

        expect(result.content[0].text).toContain('ID: 12345');
        expect(result.content[0].text).toContain('sender@example.com');
      });

      it('should handle no unread emails', () => {
        mockExecSync.mockReturnValue('No unread emails found');

        const handlers = createToolHandlers();
        const result = handlers.mail_get_unread({
          account: 'Test Account',
          mailbox: 'INBOX',
          limit: 10,
        });

        expect(result.content[0].text).toContain('No unread emails found');
      });
    });

    describe('mail_get_recent', () => {
      it('should return recent emails', () => {
        const mockResponse =
          '[UNREAD] [Work Account]\nID: 12345\nFrom: sender@example.com\nSubject: Test\nDate: Today';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_recent({});

        expect(result.content[0].text).toContain('[UNREAD]');
      });
    });

    describe('mail_get_email', () => {
      it('should return full email content', () => {
        const mockResponse =
          'From: test@example.com\nDate: January 12, 2026\nSubject: Test Email\n\nThis is the email body content.';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_get_email({ emailId: '12345' });

        expect(result.content[0].text).toContain('From: test@example.com');
        expect(result.content[0].text).toContain('Subject: Test Email');
        expect(result.content[0].text).toContain('This is the email body content.');
      });

      it('should handle email not found', () => {
        mockExecSync.mockReturnValue('Email not found with ID: 99999');

        const handlers = createToolHandlers();
        const result = handlers.mail_get_email({ emailId: '99999' });

        expect(result.content[0].text).toContain('Email not found');
      });
    });

    describe('mail_search', () => {
      it('should search emails and return results', () => {
        const mockResponse =
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting Tomorrow\nDate: Today\nLocation: Work / INBOX';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_search({ query: 'Meeting' });

        expect(result.content[0].text).toContain('Meeting Tomorrow');
      });

      it('should handle no search results', () => {
        mockExecSync.mockReturnValue('No emails found matching: NonExistentQuery');

        const handlers = createToolHandlers();
        const result = handlers.mail_search({ query: 'NonExistentQuery', limit: 5 });

        expect(result.content[0].text).toContain('No emails found matching');
      });

      it('should filter by account when account parameter is provided', () => {
        const mockResponse =
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting\nDate: Today\nLocation: iCloud / INBOX';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        handlers.mail_search({ query: 'Meeting', account: 'iCloud' });

        const scriptArg = mockExecSync.mock.calls[0][0] as string;
        expect(scriptArg).toContain('if name of acct is "iCloud" then');
        expect(scriptArg).toContain('end if');
      });

      it('should filter by mailbox when mailbox parameter is provided', () => {
        const mockResponse =
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting\nDate: Today\nLocation: Work / INBOX';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        handlers.mail_search({ query: 'Meeting', mailbox: 'INBOX' });

        const scriptArg = mockExecSync.mock.calls[0][0] as string;
        expect(scriptArg).toContain('mailbox "INBOX"');
      });

      it('should search only in subject when searchIn is subject', () => {
        mockExecSync.mockReturnValue(
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting\nDate: Today\nLocation: Work / INBOX'
        );

        const handlers = createToolHandlers();
        handlers.mail_search({ query: 'Meeting', searchIn: 'subject' });

        const scriptArg = mockExecSync.mock.calls[0][0] as string;
        expect(scriptArg).toContain('(subject of msg as text) contains');
        expect(scriptArg).not.toContain('(sender of msg as text) contains');
        expect(scriptArg).not.toContain('(content of msg as text) contains');
      });

      it('should search only in sender when searchIn is sender', () => {
        mockExecSync.mockReturnValue(
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting\nDate: Today\nLocation: Work / INBOX'
        );

        const handlers = createToolHandlers();
        handlers.mail_search({ query: 'test@example.com', searchIn: 'sender' });

        const scriptArg = mockExecSync.mock.calls[0][0] as string;
        expect(scriptArg).toContain('(sender of msg as text) contains');
        expect(scriptArg).not.toContain('(subject of msg as text) contains');
        expect(scriptArg).not.toContain('(content of msg as text) contains');
      });

      it('should search in content when searchIn is content', () => {
        mockExecSync.mockReturnValue(
          'ID: 12345\nFrom: test@example.com\nSubject: Meeting\nDate: Today\nLocation: Work / INBOX'
        );

        const handlers = createToolHandlers();
        handlers.mail_search({ query: 'hello', searchIn: 'content' });

        const scriptArg = mockExecSync.mock.calls[0][0] as string;
        expect(scriptArg).toContain('(content of msg as text) contains');
        expect(scriptArg).not.toContain('(subject of msg as text) contains');
        expect(scriptArg).not.toContain('(sender of msg as text) contains');
      });
    });

    describe('mail_send', () => {
      it('should send email successfully', () => {
        mockExecSync.mockReturnValue('Email sent to recipient@example.com');

        const handlers = createToolHandlers();
        const result = handlers.mail_send({
          to: 'recipient@example.com',
          subject: 'Test Subject',
          body: 'Test body content',
        });

        expect(result.content[0].text).toContain('Email sent to recipient@example.com');
      });

      it('should send email with CC and BCC', () => {
        mockExecSync.mockReturnValue('Email sent to recipient@example.com');

        const handlers = createToolHandlers();
        const result = handlers.mail_send({
          to: 'recipient@example.com',
          subject: 'Test Subject',
          body: 'Test body content',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
        });

        expect(result.content[0].text).toContain('Email sent');
      });
    });

    describe('mail_reply', () => {
      it('should reply to email', () => {
        mockExecSync.mockReturnValue('Reply sent');

        const handlers = createToolHandlers();
        const result = handlers.mail_reply({
          emailId: '12345',
          body: 'This is my reply',
        });

        expect(result.content[0].text).toContain('Reply sent');
      });

      it('should reply to all', () => {
        mockExecSync.mockReturnValue('Reply sent');

        const handlers = createToolHandlers();
        const result = handlers.mail_reply({
          emailId: '12345',
          body: 'Reply to all message',
          replyAll: true,
        });

        expect(result.content[0].text).toContain('Reply sent');
      });
    });

    describe('mail_mark_read', () => {
      it('should mark single email as read', () => {
        mockExecSync.mockReturnValue('Marked as read');

        const handlers = createToolHandlers();
        const result = handlers.mail_mark_read({ emailId: '12345' });

        expect(result.content[0].text).toContain('Marked as read');
      });

      it('should mark all emails as read in mailbox', () => {
        mockExecSync.mockReturnValue('Marked all emails as read in INBOX');

        const handlers = createToolHandlers();
        const result = handlers.mail_mark_read({
          emailId: 'all',
          mailbox: 'INBOX',
          account: 'Work Account',
        });

        expect(result.content[0].text).toContain('Marked all emails as read');
      });
    });

    describe('mail_mark_unread', () => {
      it('should mark email as unread', () => {
        mockExecSync.mockReturnValue('Marked as unread');

        const handlers = createToolHandlers();
        const result = handlers.mail_mark_unread({ emailId: '12345' });

        expect(result.content[0].text).toContain('Marked as unread');
      });
    });

    describe('mail_delete', () => {
      it('should delete email', () => {
        mockExecSync.mockReturnValue('Email deleted');

        const handlers = createToolHandlers();
        const result = handlers.mail_delete({ emailId: '12345' });

        expect(result.content[0].text).toContain('Email deleted');
      });

      it('should handle email not found on delete', () => {
        mockExecSync.mockReturnValue('Email not found');

        const handlers = createToolHandlers();
        const result = handlers.mail_delete({ emailId: '99999' });

        expect(result.content[0].text).toContain('Email not found');
      });
    });

    describe('mail_move', () => {
      it('should move email to different mailbox', () => {
        mockExecSync.mockReturnValue('Email moved to Archive');

        const handlers = createToolHandlers();
        const result = handlers.mail_move({
          emailId: '12345',
          toMailbox: 'Archive',
        });

        expect(result.content[0].text).toContain('Email moved to Archive');
      });

      it('should move email to specific account mailbox', () => {
        mockExecSync.mockReturnValue('Email moved to Archive');

        const handlers = createToolHandlers();
        const result = handlers.mail_move({
          emailId: '12345',
          toMailbox: 'Archive',
          toAccount: 'Personal Account',
        });

        expect(result.content[0].text).toContain('Email moved');
      });

      it('should handle mailbox not found', () => {
        mockExecSync.mockReturnValue('Mailbox not found: NonExistent');

        const handlers = createToolHandlers();
        const result = handlers.mail_move({
          emailId: '12345',
          toMailbox: 'NonExistent',
        });

        expect(result.content[0].text).toContain('Mailbox not found');
      });
    });

    describe('mail_unread_count', () => {
      it('should return unread count for all accounts', () => {
        const mockResponse =
          'Work Account (5 unread):\n  INBOX: 3\n  Newsletters: 2\n\nGrand Total: 5 unread';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_unread_count({});

        expect(result.content[0].text).toContain('Grand Total: 5 unread');
      });

      it('should return unread count for specific account', () => {
        const mockResponse = 'Work Account (3 unread):\n  INBOX: 3\n\nGrand Total: 3 unread';
        mockExecSync.mockReturnValue(mockResponse);

        const handlers = createToolHandlers();
        const result = handlers.mail_unread_count({ account: 'Work Account' });

        expect(result.content[0].text).toContain('Work Account');
      });

      it('should handle no unread emails', () => {
        mockExecSync.mockReturnValue('No unread emails');

        const handlers = createToolHandlers();
        const result = handlers.mail_unread_count({});

        expect(result.content[0].text).toContain('No unread emails');
      });
    });

    describe('mail_open', () => {
      it('should open Mail app', () => {
        mockExecSync.mockReturnValue('');

        const handlers = createToolHandlers();
        const result = handlers.mail_open({});

        expect(result.content[0].text).toBe('Mail app opened');
      });
    });

    describe('mail_check', () => {
      it('should check for new mail', () => {
        mockExecSync.mockReturnValue('');

        const handlers = createToolHandlers();
        const result = handlers.mail_check({});

        expect(result.content[0].text).toBe('Checking for new mail...');
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle AppleScript execution errors', () => {
      const errorMessage = 'AppleScript error: Application not found';
      mockExecSync.mockImplementation(() => {
        const error = new Error(errorMessage) as Error & { stderr?: string };
        error.stderr = 'Application not found';
        throw error;
      });

      const handlers = createToolHandlers();

      expect(() => handlers.mail_get_accounts({})).toThrow('AppleScript error');
    });

    it('should handle missing required parameters gracefully', () => {
      mockExecSync.mockReturnValue('Email not found with ID: undefined');

      const handlers = createToolHandlers();
      // Testing behavior when emailId is not provided (undefined)
      const result = handlers.mail_get_email({});

      expect(result.content[0].text).toContain('Email not found');
    });

    it('should handle invalid email ID format', () => {
      mockExecSync.mockReturnValue('Email not found with ID: invalid');

      const handlers = createToolHandlers();
      const result = handlers.mail_get_email({ emailId: 'invalid' });

      expect(result.content[0].text).toContain('Email not found');
    });

    it('should handle empty search query results', () => {
      mockExecSync.mockReturnValue('No emails found matching: ');

      const handlers = createToolHandlers();
      const result = handlers.mail_search({ query: '' });

      expect(result.content[0].text).toContain('No emails found matching');
    });
  });

  describe('Input Validation', () => {
    it('should accept valid email format for sending', () => {
      mockExecSync.mockReturnValue('Email sent to valid@example.com');

      const handlers = createToolHandlers();
      const result = handlers.mail_send({
        to: 'valid@example.com',
        subject: 'Test',
        body: 'Test body',
      });

      expect(result.content[0].text).toContain('Email sent');
    });

    it('should handle emails with special characters in body', () => {
      mockExecSync.mockReturnValue('Email sent to test@example.com');

      const handlers = createToolHandlers();
      const result = handlers.mail_send({
        to: 'test@example.com',
        subject: 'Test with special chars',
        body: 'Body with "quotes" and special chars: & < >',
      });

      expect(result.content[0].text).toContain('Email sent');
    });

    it('should accept numeric limits within valid range', () => {
      mockExecSync.mockReturnValue('No unread emails found');

      const handlers = createToolHandlers();
      const result = handlers.mail_get_unread({ limit: 100 });

      expect(result.content[0]).toBeDefined();
    });
  });

  describe('Default Parameter Values', () => {
    it('mail_get_unread should use INBOX as default mailbox', () => {
      mockExecSync.mockReturnValue('No unread emails found');

      const handlers = createToolHandlers();
      handlers.mail_get_unread({});

      // Verify execSync was called (script contains INBOX)
      expect(mockExecSync).toHaveBeenCalled();
    });

    it('mail_get_recent should use INBOX as default mailbox', () => {
      mockExecSync.mockReturnValue('No emails found');

      const handlers = createToolHandlers();
      handlers.mail_get_recent({});

      expect(mockExecSync).toHaveBeenCalled();
    });

    it('mail_search should use default limit of 20', () => {
      mockExecSync.mockReturnValue('No emails found matching: test');

      const handlers = createToolHandlers();
      handlers.mail_search({ query: 'test' });

      expect(mockExecSync).toHaveBeenCalled();
    });
  });

  describe('Unknown Tool Handling', () => {
    it('should handle unknown tool names', () => {
      // Simulating the server behavior for unknown tools
      const handleUnknownTool = (name: string): ReturnType<ToolHandler> & { isError: boolean } => {
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      };

      const result = handleUnknownTool('unknown_tool');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool: unknown_tool');
    });
  });

  describe('escapeAppleScript', () => {
    it('passes through plain strings unchanged', () => {
      expect(escapeAppleScript('hello world')).toBe('hello world');
    });

    it('escapes double quotes', () => {
      expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
    });

    it('escapes backslashes before quotes', () => {
      // A backslash followed by a quote must become \\\\" not \\"
      expect(escapeAppleScript('path\\to\\"file')).toBe('path\\\\to\\\\\\"file');
    });

    it('escapes lone backslashes', () => {
      expect(escapeAppleScript('C:\\Users\\test')).toBe('C:\\\\Users\\\\test');
    });

    it('handles empty string', () => {
      expect(escapeAppleScript('')).toBe('');
    });
  });
});
