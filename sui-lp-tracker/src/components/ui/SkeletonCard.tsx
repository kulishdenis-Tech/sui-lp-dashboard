import { appCardSurface } from '@/design/appPrimitives'

export function SkeletonCard() {
	return <div className={`${appCardSurface} h-32 animate-pulse`} />
}
