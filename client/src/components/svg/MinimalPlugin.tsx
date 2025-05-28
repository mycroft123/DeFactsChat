export default function MinimalPlugin({
  size = 24,
  className = 'icon-md',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img 
      src="/assets/logo.svg"
      width={size} 
      height={size} 
      className={className} 
      alt="DeFacts AI"
      style={{ objectFit: 'contain' }}
    />
  );
}