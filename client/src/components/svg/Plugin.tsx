import { cn } from '~/utils/';

export default function Plugin({ className = '', ...props }) {
  return (
    <img 
      src="/assets/logo.svg"
      className={cn('h-4 w-4', className)}
      alt="DeFacts"
      {...props}
    />
  );
}