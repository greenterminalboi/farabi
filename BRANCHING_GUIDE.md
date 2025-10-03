# Farabi - Conversation Branching System

## Overview

Farabi implements a Git-like conversation branching system that allows you to create multiple independent conversation threads from any point in a discussion.

## Features

### ✅ Thread Isolation
Each thread maintains its own independent conversation history. When you add messages to a branch, they do NOT affect parent or sibling branches.

**Example:**
```
Main Thread (A)
├── Branch 1 (AB1) - independent from Main
│   └── Branch 1.1 (AB1C) - independent from AB1 and Main
└── Branch 2 (AB2) - independent from AB1 and Main
```

### ✅ Message Inheritance
When creating a new branch, all messages from the parent thread are copied to the child thread, providing full conversation context.

### ✅ Multiple Branching Methods

1. **Text Selection Branching**
   - Select any text in an assistant's response
   - A floating "Branch from this" button appears
   - Option to branch with or without an additional question

2. **Action Bar Branching**
   - Click the Git branch icon next to Copy/Refresh buttons
   - Appears when hovering over assistant messages

### ✅ Navigation

1. **Breadcrumb Navigation**
   - Shows current thread path (e.g., "Main → Branch 1 → Branch 1.1")
   - Intelligently collapses when too many levels
   - Click any breadcrumb to navigate to that thread

2. **Hierarchical Sidebar**
   - Tree view with indent levels
   - Color-coded by depth (blue, green, purple, orange, pink)
   - Expand/collapse branches
   - Delete branches (with all children)
   - Visual tree lines connecting related threads

## Usage

### Creating a Branch

1. **From Text Selection:**
   ```
   1. Ask the AI a question
   2. Wait for response
   3. Select any text in the response
   4. Click "Branch from this"
   5. Optionally add a follow-up question
   6. Click "Branch" or "Branch Without Question"
   ```

2. **From Action Bar:**
   ```
   1. Hover over an assistant message
   2. Click the Git branch icon (next to copy/refresh)
   3. Follow the same dialog as text selection
   ```

### Navigating Threads

1. **Using Breadcrumbs:**
   - Click any thread name in the breadcrumb bar at the top

2. **Using Sidebar:**
   - Click any thread in the hierarchical tree view
   - Use collapse/expand buttons to manage visibility

### Managing Threads

- **Delete a Branch:** Click the trash icon when hovering over a thread in the sidebar
  - This deletes the thread and ALL its children
  - Main thread cannot be deleted

- **New Thread:** Click "+ New Thread" button to return to main conversation

## Architecture

### Core Components

1. **ThreadManager** (`lib/thread-manager.ts`)
   - Core logic for thread operations
   - Message isolation and inheritance
   - localStorage persistence

2. **useThreadBranching** (`hooks/use-thread-branching.ts`)
   - React hook for thread state management
   - Handles selection and branching UI

3. **Thread Components**
   - `Thread` - Main conversation display
   - `BranchButton` - Floating branch dialog
   - `ThreadBreadcrumbs` - Navigation bar
   - `HierarchicalThreadList` - Sidebar tree view

### Data Structure

```typescript
interface ThreadNode {
  id: string;
  parentId: string | null;
  title: string;
  selectedText?: string;
  branchPoint?: string;
  timestamp: number;
  messages: any[]; // Independent message array
  depth: number;
}

interface ThreadTree {
  threads: Map<string, ThreadNode>;
  activeThreadId: string;
  mainThreadId: string;
}
```

## Testing

Run the test suite:
```bash
npm test
```

Test coverage includes:
- ✅ Branch creation with message inheritance
- ✅ Message independence between threads
- ✅ Nested branch handling
- ✅ Thread isolation (updates only affect target thread)
- ✅ Path navigation
- ✅ Thread deletion with children

## Key Implementation Details

### Message Isolation

When you update messages in a branch:
```typescript
// Only the specified thread is updated
ThreadManager.updateThreadMessages(tree, threadId, newMessages)
// Parent and sibling threads remain unchanged
```

### Message Inheritance

When creating a branch:
```typescript
// All parent messages are COPIED to the child
ThreadManager.createBranch(tree, text, point, parentId, currentMessages)
// Child starts with parent's full history
// But future updates are independent
```

### Storage

All thread data is persisted in localStorage:
- Automatic save on every operation
- Restored on page reload
- Thread tree structure maintained

## Future Enhancements

- [ ] Runtime integration for real-time message synchronization
- [ ] Thread merge capabilities
- [ ] Export/import thread trees
- [ ] Visual diff between branches
- [ ] Thread search and filtering

## Troubleshooting

### Branches showing parent updates
- Check that you're passing currentMessages to createBranch
- Verify updateMessages is called on the correct thread ID

### Messages not persisting
- Ensure localStorage is available
- Check browser console for errors
- Clear localStorage and restart if corrupted

### Sidebar not updating
- Verify threadHierarchy is being passed correctly
- Check that ThreadManager.saveThreadTree is called after operations
