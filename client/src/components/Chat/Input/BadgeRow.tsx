import React, {
  memo,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useReducer,
} from 'react';
import { useRecoilValue, useRecoilCallback, useSetRecoilState } from 'recoil';
import type { LucideIcon } from 'lucide-react';
import CodeInterpreter from './CodeInterpreter';
import type { BadgeItem } from '~/common';
import { useChatBadges } from '~/hooks';
import { Badge } from '~/components/ui';
import MCPSelect from './MCPSelect';
import store from '~/store';

interface BadgeRowProps {
  showEphemeralBadges?: boolean;
  onChange: (badges: Pick<BadgeItem, 'id'>[]) => void;
  onToggle?: (badgeId: string, currentActive: boolean) => void;
  onAIModeChange?: (mode: string) => void;
  onModelChange?: (model: string) => void; // Add this for model updates
  conversationId?: string | null;
  isInChat: boolean;
}

interface BadgeWrapperProps {
  badge: BadgeItem;
  isEditing: boolean;
  isInChat: boolean;
  onToggle: (badge: BadgeItem) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent, badge: BadgeItem, isActive: boolean) => void;
  badgeRefs: React.MutableRefObject<Record<string, HTMLDivElement>>;
}

const BadgeWrapper = React.memo(
  forwardRef<HTMLDivElement, BadgeWrapperProps>(
    ({ badge, isEditing, isInChat, onToggle, onDelete, onMouseDown, badgeRefs }, ref) => {
      const atomBadge = useRecoilValue(badge.atom);
      const isActive = badge.atom ? atomBadge : false;

      return (
        <div
          ref={(el) => {
            if (el) {
              badgeRefs.current[badge.id] = el;
            }
            if (typeof ref === 'function') {
              ref(el);
            } else if (ref) {
              ref.current = el;
            }
          }}
          onMouseDown={(e) => onMouseDown(e, badge, isActive)}
          className={isEditing ? 'ios-wiggle badge-icon h-full' : 'badge-icon h-full'}
        >
          <Badge
            id={badge.id}
            icon={badge.icon as LucideIcon}
            label={badge.label}
            isActive={isActive}
            isEditing={isEditing}
            isAvailable={badge.isAvailable}
            isInChat={isInChat}
            onToggle={() => onToggle(badge)}
            onBadgeAction={() => onDelete(badge.id)}
          />
        </div>
      );
    },
  ),
  (prevProps, nextProps) =>
    prevProps.badge.id === nextProps.badge.id &&
    prevProps.isEditing === nextProps.isEditing &&
    prevProps.isInChat === nextProps.isInChat &&
    prevProps.onToggle === nextProps.onToggle &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.onMouseDown === nextProps.onMouseDown &&
    prevProps.badgeRefs === nextProps.badgeRefs,
);

BadgeWrapper.displayName = 'BadgeWrapper';

interface DragState {
  draggedBadge: BadgeItem | null;
  mouseX: number;
  offsetX: number;
  insertIndex: number | null;
  draggedBadgeActive: boolean;
}

type DragAction =
  | {
      type: 'START_DRAG';
      badge: BadgeItem;
      mouseX: number;
      offsetX: number;
      insertIndex: number;
      isActive: boolean;
    }
  | { type: 'UPDATE_POSITION'; mouseX: number; insertIndex: number }
  | { type: 'END_DRAG' };

const dragReducer = (state: DragState, action: DragAction): DragState => {
  switch (action.type) {
    case 'START_DRAG':
      return {
        draggedBadge: action.badge,
        mouseX: action.mouseX,
        offsetX: action.offsetX,
        insertIndex: action.insertIndex,
        draggedBadgeActive: action.isActive,
      };
    case 'UPDATE_POSITION':
      return {
        ...state,
        mouseX: action.mouseX,
        insertIndex: action.insertIndex,
      };
    case 'END_DRAG':
      return {
        draggedBadge: null,
        mouseX: 0,
        offsetX: 0,
        insertIndex: null,
        draggedBadgeActive: false,
      };
    default:
      return state;
  }
};

function BadgeRow({
  showEphemeralBadges,
  conversationId,
  onChange,
  onToggle,
  onAIModeChange,
  onModelChange,
  isInChat,
}: BadgeRowProps) {
  const [orderedBadges, setOrderedBadges] = useState<BadgeItem[]>([]);
  const [aiMode, setAIMode] = useState('defacts');
  const [dragState, dispatch] = useReducer(dragReducer, {
    draggedBadge: null,
    mouseX: 0,
    offsetX: 0,
    insertIndex: null,
    draggedBadgeActive: false,
  });

  const badgeRefs = useRef<Record<string, HTMLDivElement>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrame = useRef<number | null>(null);
  const containerRectRef = useRef<DOMRect | null>(null);

  const allBadges = useChatBadges();
  const isEditing = useRecoilValue(store.isEditingBadges);
  
  // Try to use setConversation if it exists, otherwise we'll use the callback
  let setConversation: any = null;
  try {
    // Only uncomment this if store.conversation exists
    // setConversation = useSetRecoilState(store.conversation);
  } catch (error) {
    console.log('store.conversation not available, using callback method');
  }

  const badges = useMemo(
    () => allBadges.filter((badge) => badge.isAvailable !== false),
    [allBadges],
  );

  const toggleBadge = useRecoilCallback(
    ({ snapshot, set }) =>
      async (badgeAtom: any) => {
        const current = await snapshot.getPromise(badgeAtom);
        set(badgeAtom, !current);
      },
    [],
  );

  useEffect(() => {
    setOrderedBadges((prev) => {
      const currentIds = new Set(prev.map((b) => b.id));
      const newBadges = badges.filter((b) => !currentIds.has(b.id));
      return newBadges.length > 0 ? [...prev, ...newBadges] : prev;
    });
  }, [badges]);

  const tempBadges = dragState.draggedBadge
    ? orderedBadges.filter((b) => b.id !== dragState.draggedBadge?.id)
    : orderedBadges;
  const ghostBadge = dragState.draggedBadge || null;

  const calculateInsertIndex = useCallback(
    (currentMouseX: number): number => {
      if (!dragState.draggedBadge || !containerRef.current || !containerRectRef.current) {
        return 0;
      }
      const relativeMouseX = currentMouseX - containerRectRef.current.left;
      const refs = tempBadges.map((b) => badgeRefs.current[b.id]).filter(Boolean);
      if (refs.length === 0) {
        return 0;
      }
      let idx = 0;
      for (let i = 0; i < refs.length; i++) {
        const rect = refs[i].getBoundingClientRect();
        const relativeLeft = rect.left - containerRectRef.current.left;
        const relativeCenter = relativeLeft + rect.width / 2;
        if (relativeMouseX < relativeCenter) {
          break;
        }
        idx = i + 1;
      }
      return idx;
    },
    [dragState.draggedBadge, tempBadges],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, badge: BadgeItem, isActive: boolean) => {
      if (!isEditing || !containerRef.current) {
        return;
      }
      const el = badgeRefs.current[badge.id];
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const mouseX = e.clientX;
      const initialIndex = orderedBadges.findIndex((b) => b.id === badge.id);
      containerRectRef.current = containerRef.current.getBoundingClientRect();
      dispatch({
        type: 'START_DRAG',
        badge,
        mouseX,
        offsetX,
        insertIndex: initialIndex,
        isActive,
      });
    },
    [isEditing, orderedBadges],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState.draggedBadge) {
        return;
      }
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      animationFrame.current = requestAnimationFrame(() => {
        const newMouseX = e.clientX;
        const newInsertIndex = calculateInsertIndex(newMouseX);
        if (newInsertIndex !== dragState.insertIndex) {
          dispatch({ type: 'UPDATE_POSITION', mouseX: newMouseX, insertIndex: newInsertIndex });
        } else {
          dispatch({
            type: 'UPDATE_POSITION',
            mouseX: newMouseX,
            insertIndex: dragState.insertIndex,
          });
        }
      });
    },
    [dragState.draggedBadge, dragState.insertIndex, calculateInsertIndex],
  );

  const handleMouseUp = useCallback(() => {
    if (dragState.draggedBadge && dragState.insertIndex !== null) {
      const otherBadges = orderedBadges.filter((b) => b.id !== dragState.draggedBadge?.id);
      const newBadges = [
        ...otherBadges.slice(0, dragState.insertIndex),
        dragState.draggedBadge,
        ...otherBadges.slice(dragState.insertIndex),
      ];
      setOrderedBadges(newBadges);
      onChange(newBadges.map((badge) => ({ id: badge.id })));
    }
    dispatch({ type: 'END_DRAG' });
    containerRectRef.current = null;
  }, [dragState.draggedBadge, dragState.insertIndex, orderedBadges, onChange]);

  const handleDelete = useCallback(
    (badgeId: string) => {
      const newBadges = orderedBadges.filter((b) => b.id !== badgeId);
      setOrderedBadges(newBadges);
      onChange(newBadges.map((badge) => ({ id: badge.id })));
    },
    [orderedBadges, onChange],
  );

  const handleBadgeToggle = useCallback(
    (badge: BadgeItem) => {
      if (badge.atom) {
        toggleBadge(badge.atom);
      }
      if (onToggle) {
        onToggle(badge.id, !!badge.atom);
      }
    },
    [toggleBadge, onToggle],
  );

  const handleAIModeChange = useCallback(
    (mode: string) => {
      console.log('BadgeRow: Changing AI mode to:', mode);
      setAIMode(mode);
      
      // IMPORTANT: Call the parent's callback to update placeholder FIRST
      if (onAIModeChange) {
        console.log('BadgeRow: Calling parent onAIModeChange');
        onAIModeChange(mode);
      }
      
      // Map mode to model names
      const modeToModel: Record<string, string> = {
        'defacts': 'Facts',
        'denews': 'News',
        'deresearch': 'Research'
      };
      
      const modelName = modeToModel[mode];
      
      // Try to update conversation state directly if available
      if (setConversation) {
        try {
          setConversation((prev: any) => {
            console.log('Updating conversation model from:', prev?.model, 'to:', modelName);
            if (!prev) {
              return {
                endpoint: 'gptPlugins',
                model: modelName,
              };
            }
            return {
              ...prev,
              endpoint: 'gptPlugins',
              model: modelName,
            };
          });
        } catch (error) {
          console.error('Error updating conversation:', error);
        }
      }
      
      // Always use the callback method as backup or primary method
      if (onModelChange) {
        console.log('BadgeRow: Using callback to update model to:', modelName);
        onModelChange(modelName);
      }
    },
    [onAIModeChange, onModelChange, setConversation],
  );

  useEffect(() => {
    if (!dragState.draggedBadge) {
      return;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
        animationFrame.current = null;
      }
    };
  }, [dragState.draggedBadge, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      {tempBadges.map((badge, index) => (
        <React.Fragment key={badge.id}>
          {dragState.draggedBadge && dragState.insertIndex === index && ghostBadge && (
            <div className="badge-icon h-full">
              <Badge
                id={ghostBadge.id}
                icon={ghostBadge.icon as LucideIcon}
                label={ghostBadge.label}
                isActive={dragState.draggedBadgeActive}
                isEditing={isEditing}
                isAvailable={ghostBadge.isAvailable}
                isInChat={isInChat}
              />
            </div>
          )}
          <BadgeWrapper
            badge={badge}
            isEditing={isEditing}
            isInChat={isInChat}
            onToggle={handleBadgeToggle}
            onDelete={handleDelete}
            onMouseDown={handleMouseDown}
            badgeRefs={badgeRefs}
          />
        </React.Fragment>
      ))}
      {dragState.draggedBadge && dragState.insertIndex === tempBadges.length && ghostBadge && (
        <div className="badge-icon h-full">
          <Badge
            id={ghostBadge.id}
            icon={ghostBadge.icon as LucideIcon}
            label={ghostBadge.label}
            isActive={dragState.draggedBadgeActive}
            isEditing={isEditing}
            isAvailable={ghostBadge.isAvailable}
            isInChat={isInChat}
          />
        </div>
      )}
      {showEphemeralBadges === true && (
        <>
          <div className="flex items-center gap-2 ml-3">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAIModeChange('defacts');
              }}
              className={`
                px-3 py-1.5 rounded-md text-sm font-medium 
                transition-all duration-200 border
                ${aiMode === 'defacts' 
                  ? 'bg-green-500 text-white border-green-600 font-semibold shadow-md' 
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }
              `}
            >
              DeFacts
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAIModeChange('denews');
              }}
              className={`
                px-3 py-1.5 rounded-md text-sm font-medium 
                transition-all duration-200 border
                ${aiMode === 'denews' 
                  ? 'bg-blue-500 text-white border-blue-600 font-semibold shadow-md' 
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }
              `}
            >
              DeNews
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAIModeChange('deresearch');
              }}
              className={`
                px-3 py-1.5 rounded-md text-sm font-medium 
                transition-all duration-200 border
                ${aiMode === 'deresearch' 
                  ? 'bg-red-500 text-white border-red-600 font-semibold shadow-md' 
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                }
              `}
            >
              DeResearch
            </button>
          </div>
          {/* <CodeInterpreter conversationId={conversationId} /> */}
          <MCPSelect conversationId={conversationId} />
        </>
      )}
      {ghostBadge && (
        <div
          className="ghost-badge h-full"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `translateX(${dragState.mouseX - dragState.offsetX - (containerRectRef.current?.left || 0)}px)`,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <Badge
            id={ghostBadge.id}
            icon={ghostBadge.icon as LucideIcon}
            label={ghostBadge.label}
            isActive={dragState.draggedBadgeActive}
            isAvailable={ghostBadge.isAvailable}
            isInChat={isInChat}
            isEditing
            isDragging
          />
        </div>
      )}
    </div>
  );
}

export default memo(BadgeRow);