import { ThreadManager, ThreadTree, ThreadNode } from '../thread-manager';

describe('ThreadManager', () => {
  let mockTree: ThreadTree;
  
  beforeEach(() => {
    // Create a fresh tree for each test
    const mainThreadId = 'main-thread-id';
    const mainThread: ThreadNode = {
      id: mainThreadId,
      parentId: null,
      title: 'Main Conversation',
      timestamp: Date.now(),
      messages: [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
      ],
      depth: 0,
    };

    mockTree = {
      threads: new Map([[mainThreadId, mainThread]]),
      activeThreadId: mainThreadId,
      mainThreadId,
    };
  });

  describe('createBranch', () => {
    it('should create a new branch with inherited messages', () => {
      const selectedText = 'Test text';
      const currentMessages = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
      ];

      const updatedTree = ThreadManager.createBranch(
        mockTree,
        selectedText,
        'msg-id',
        mockTree.mainThreadId,
        currentMessages
      );

      // Should have 2 threads now
      expect(updatedTree.threads.size).toBe(2);
      
      // Get the new branch
      const branches = Array.from(updatedTree.threads.values()).filter(
        t => t.parentId === mockTree.mainThreadId
      );
      expect(branches.length).toBe(1);
      
      const newBranch = branches[0];
      
      // Verify branch properties
      expect(newBranch.parentId).toBe(mockTree.mainThreadId);
      expect(newBranch.selectedText).toBe(selectedText);
      expect(newBranch.depth).toBe(1);
      
      // Verify messages were inherited
      expect(newBranch.messages).toEqual(currentMessages);
      expect(newBranch.messages.length).toBe(3);
    });

    it('should create independent message arrays', () => {
      const currentMessages = [
        { role: 'user', content: 'Message 1' },
      ];

      const tree1 = ThreadManager.createBranch(
        mockTree,
        'Branch 1',
        'msg-id',
        mockTree.mainThreadId,
        currentMessages
      );

      const branch1 = Array.from(tree1.threads.values()).find(
        t => t.title === 'Branch: "Branch 1"'
      )!;

      // Add message to branch1
      const newMessages = [...branch1.messages, { role: 'assistant', content: 'Branch 1 Response' }];
      const tree2 = ThreadManager.updateThreadMessages(tree1, branch1.id, newMessages);

      // Now create branch2 from main thread
      const tree3 = ThreadManager.createBranch(
        tree2,
        'Branch 2',
        'msg-id',
        mockTree.mainThreadId,
        currentMessages
      );

      const branch2 = Array.from(tree3.threads.values()).find(
        t => t.title === 'Branch: "Branch 2"'
      )!;

      // Branch 1 should have its own message
      const updatedBranch1 = tree3.threads.get(branch1.id)!;
      expect(updatedBranch1.messages.length).toBe(2);
      expect(updatedBranch1.messages[1].content).toBe('Branch 1 Response');

      // Branch 2 should only have the original message
      expect(branch2.messages.length).toBe(1);
      expect(branch2.messages[0].content).toBe('Message 1');
    });

    it('should handle nested branches correctly', () => {
      const messages1 = [{ role: 'user', content: 'A' }];
      
      // Create first branch from main
      const tree1 = ThreadManager.createBranch(
        mockTree,
        'AB',
        'msg-id',
        mockTree.mainThreadId,
        messages1
      );

      const branchAB = Array.from(tree1.threads.values()).find(
        t => t.parentId === mockTree.mainThreadId
      )!;

      // Add messages to AB
      const messagesAB = [...branchAB.messages, { role: 'assistant', content: 'B' }];
      const tree2 = ThreadManager.updateThreadMessages(tree1, branchAB.id, messagesAB);

      // Create nested branch from AB
      const tree3 = ThreadManager.createBranch(
        tree2,
        'ABC',
        'msg-id',
        branchAB.id,
        messagesAB
      );

      const branchABC = Array.from(tree3.threads.values()).find(
        t => t.parentId === branchAB.id
      )!;

      // Verify depths
      expect(branchAB.depth).toBe(1);
      expect(branchABC.depth).toBe(2);

      // Verify message inheritance
      expect(branchABC.messages).toEqual(messagesAB);
    });
  });

  describe('updateThreadMessages', () => {
    it('should only update the specified thread', () => {
      const messages1 = [{ role: 'user', content: 'A' }];
      
      // Create two branches
      const tree1 = ThreadManager.createBranch(
        mockTree,
        'Branch 1',
        'msg-id',
        mockTree.mainThreadId,
        messages1
      );

      const tree2 = ThreadManager.createBranch(
        tree1,
        'Branch 2',
        'msg-id',
        mockTree.mainThreadId,
        messages1
      );

      const branch1 = Array.from(tree2.threads.values()).find(
        t => t.title === 'Branch: "Branch 1"'
      )!;

      const branch2 = Array.from(tree2.threads.values()).find(
        t => t.title === 'Branch: "Branch 2"'
      )!;

      // Update branch1 messages
      const newMessages = [...branch1.messages, { role: 'assistant', content: 'Only in Branch 1' }];
      const tree3 = ThreadManager.updateThreadMessages(tree2, branch1.id, newMessages);

      // Verify branch1 was updated
      const updatedBranch1 = tree3.threads.get(branch1.id)!;
      expect(updatedBranch1.messages.length).toBe(2);

      // Verify branch2 was NOT updated
      const unchangedBranch2 = tree3.threads.get(branch2.id)!;
      expect(unchangedBranch2.messages.length).toBe(1);

      // Verify main thread was NOT updated
      const unchangedMain = tree3.threads.get(mockTree.mainThreadId)!;
      expect(unchangedMain.messages.length).toBe(2); // Original messages
    });
  });

  describe('getThreadPath', () => {
    it('should return correct path for nested threads', () => {
      const messages1 = [{ role: 'user', content: 'A' }];
      
      // Create A -> AB -> ABC hierarchy
      const tree1 = ThreadManager.createBranch(
        mockTree,
        'AB',
        'msg-id',
        mockTree.mainThreadId,
        messages1
      );

      const branchAB = Array.from(tree1.threads.values()).find(
        t => t.parentId === mockTree.mainThreadId
      )!;

      const tree2 = ThreadManager.createBranch(
        tree1,
        'ABC',
        'msg-id',
        branchAB.id,
        messages1
      );

      const branchABC = Array.from(tree2.threads.values()).find(
        t => t.parentId === branchAB.id
      )!;

      // Get path for ABC
      const path = ThreadManager.getThreadPath(tree2, branchABC.id);

      // Should be [Main, AB, ABC]
      expect(path.length).toBe(3);
      expect(path[0].id).toBe(mockTree.mainThreadId);
      expect(path[1].id).toBe(branchAB.id);
      expect(path[2].id).toBe(branchABC.id);
    });
  });

  describe('deleteThread', () => {
    it('should delete thread and all children', () => {
      const messages1 = [{ role: 'user', content: 'A' }];
      
      // Create A -> AB -> ABC hierarchy
      const tree1 = ThreadManager.createBranch(
        mockTree,
        'AB',
        'msg-id',
        mockTree.mainThreadId,
        messages1
      );

      const branchAB = Array.from(tree1.threads.values()).find(
        t => t.parentId === mockTree.mainThreadId
      )!;

      const tree2 = ThreadManager.createBranch(
        tree1,
        'ABC',
        'msg-id',
        branchAB.id,
        messages1
      );

      // Delete AB
      const tree3 = ThreadManager.deleteThread(tree2, branchAB.id);

      // Should only have main thread left
      expect(tree3.threads.size).toBe(1);
      expect(tree3.threads.has(mockTree.mainThreadId)).toBe(true);
      expect(tree3.threads.has(branchAB.id)).toBe(false);
    });
  });
});
