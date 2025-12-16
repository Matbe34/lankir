import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stateEmitter, StateEvents } from '../src/js/eventEmitter.js';

describe('Event Emitter', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    stateEmitter.events = {};
  });

  describe('Basic Functionality', () => {
    it('should emit and receive events', () => {
      const handler = vi.fn();
      stateEmitter.on('test', handler);
      stateEmitter.emit('test', 'data');
      
      expect(handler).toHaveBeenCalledWith('data');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should support multiple handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      stateEmitter.on('test', handler1);
      stateEmitter.on('test', handler2);
      stateEmitter.emit('test', 'data');
      
      expect(handler1).toHaveBeenCalledWith('data');
      expect(handler2).toHaveBeenCalledWith('data');
    });

    it('should pass multiple arguments', () => {
      const handler = vi.fn();
      stateEmitter.on('test', handler);
      stateEmitter.emit('test', 'arg1', 'arg2', 'arg3');
      
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should not call handlers for different events', () => {
      const handler = vi.fn();
      stateEmitter.on('event1', handler);
      stateEmitter.emit('event2');
      
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once()', () => {
    it('should call handler only once', () => {
      const handler = vi.fn();
      stateEmitter.once('test', handler);
      
      stateEmitter.emit('test', 'data1');
      stateEmitter.emit('test', 'data2');
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('data1');
    });
  });

  describe('Unsubscribe', () => {
    it('should unsubscribe via returned function', () => {
      const handler = vi.fn();
      const unsubscribe = stateEmitter.on('test', handler);
      
      stateEmitter.emit('test', 'data1');
      unsubscribe();
      stateEmitter.emit('test', 'data2');
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('data1');
    });

    it('should remove specific handler only', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      const unsubscribe1 = stateEmitter.on('test', handler1);
      stateEmitter.on('test', handler2);
      
      unsubscribe1();
      stateEmitter.emit('test', 'data');
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith('data');
    });
  });

  describe('off()', () => {
    it('should remove all listeners for event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      stateEmitter.on('test', handler1);
      stateEmitter.on('test', handler2);
      stateEmitter.off('test');
      stateEmitter.emit('test', 'data');
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should not stop other handlers if one throws', () => {
      const handler1 = vi.fn(() => { throw new Error('handler1 error'); });
      const handler2 = vi.fn();
      
      stateEmitter.on('test', handler1);
      stateEmitter.on('test', handler2);
      stateEmitter.emit('test', 'data');
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('StateEvents Constants', () => {
    it('should define all required event names', () => {
      expect(StateEvents.PDF_OPENED).toBe('pdf:opened');
      expect(StateEvents.PDF_CLOSED).toBe('pdf:closed');
      expect(StateEvents.TAB_SWITCHED).toBe('tab:switched');
      expect(StateEvents.ZOOM_CHANGED).toBe('zoom:changed');
      expect(StateEvents.PAGE_CHANGED).toBe('page:changed');
    });

    it('should have unique event names', () => {
      const values = Object.values(StateEvents);
      const uniqueValues = [...new Set(values)];
      expect(values.length).toBe(uniqueValues.length);
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not accumulate handlers', () => {
      const handler = vi.fn();
      
      // Add and remove 100 times
      for (let i = 0; i < 100; i++) {
        const unsub = stateEmitter.on('test', handler);
        unsub();
      }
      
      stateEmitter.emit('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
