import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Filter,
  GripVertical,
  HelpCircle,
  Link2,
  Lock,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
  type LucideProps,
} from "lucide-react";

type IconProps = LucideProps;

export function SearchIcon({ size = 16, ...props }: IconProps) {
  return <Search size={size} aria-hidden="true" {...props} />;
}

export function PlusIcon({ size = 16, ...props }: IconProps) {
  return <Plus size={size} aria-hidden="true" {...props} />;
}

export function ChevronDownIcon({ size = 16, ...props }: IconProps) {
  return <ChevronDown size={size} aria-hidden="true" {...props} />;
}

export function ChevronRightIcon({ size = 16, ...props }: IconProps) {
  return <ChevronRight size={size} aria-hidden="true" {...props} />;
}

export function CheckIcon({ size = 16, ...props }: IconProps) {
  return <Check size={size} aria-hidden="true" {...props} />;
}

export function CloseIcon({ size = 16, ...props }: IconProps) {
  return <X size={size} aria-hidden="true" {...props} />;
}

export function StarIcon({
  size = 16,
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) {
  return <Star size={size} aria-hidden="true" {...props} fill={filled ? "currentColor" : "none"} />;
}

export function ClockIcon({ size = 16, ...props }: IconProps) {
  return <Clock size={size} aria-hidden="true" {...props} />;
}

export function LockIcon({ size = 16, ...props }: IconProps) {
  return <Lock size={size} aria-hidden="true" {...props} />;
}

export function AlertCircleIcon({ size = 16, ...props }: IconProps) {
  return <AlertCircle size={size} aria-hidden="true" {...props} />;
}

export function HelpIcon({ size = 16, ...props }: IconProps) {
  return <HelpCircle size={size} aria-hidden="true" {...props} />;
}

export function DotsIcon({ size = 16, ...props }: IconProps) {
  return <MoreHorizontal size={size} aria-hidden="true" {...props} />;
}

export function FilterIcon({ size = 16, ...props }: IconProps) {
  return <Filter size={size} aria-hidden="true" {...props} />;
}

export function MailIcon({ size = 16, ...props }: IconProps) {
  return <Mail size={size} aria-hidden="true" {...props} />;
}

export function CalendarIcon({ size = 16, ...props }: IconProps) {
  return <Calendar size={size} aria-hidden="true" {...props} />;
}

export function DocumentIcon({ size = 16, ...props }: IconProps) {
  return <FileText size={size} aria-hidden="true" {...props} />;
}

export function GripIcon({ size = 16, ...props }: IconProps) {
  return <GripVertical size={size} aria-hidden="true" {...props} />;
}

export function ArrowLeftIcon({ size = 16, ...props }: IconProps) {
  return <ArrowLeft size={size} aria-hidden="true" {...props} />;
}

export function TrashIcon({ size = 16, ...props }: IconProps) {
  return <Trash2 size={size} aria-hidden="true" {...props} />;
}

export function UploadIcon({ size = 16, ...props }: IconProps) {
  return <Upload size={size} aria-hidden="true" {...props} />;
}

export function CameraIcon({ size = 16, ...props }: IconProps) {
  return <Camera size={size} aria-hidden="true" {...props} />;
}

export function LinkIcon({ size = 16, ...props }: IconProps) {
  return <Link2 size={size} aria-hidden="true" {...props} />;
}

export function ExternalLinkIcon({ size = 16, ...props }: IconProps) {
  return <ExternalLink size={size} aria-hidden="true" {...props} />;
}
