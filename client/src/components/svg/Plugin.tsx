import { cn } from '~/utils/';

export default function Plugin({ className = '', ...props }) {
  return (
    <img 
      src="/assets/logo.svg"
      className={cn('h-full w-full', className)} // Changed from 'h-4 w-4' to 'h-full w-full'
      style={{ 
        objectFit: 'cover',  // Makes the image fill the container
        scale: '1.5'         // Makes it 50% bigger to eliminate blue background
      }}
      alt="DeFacts"
      {...props}
    />
  );
}