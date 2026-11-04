import { createContext, useContext } from 'react'

/** The element inside the always-present top navigation bar where a screen can place its own controls. */
export const NavSlotContext = createContext<HTMLElement | null>(null)

export const useNavSlot = () => useContext(NavSlotContext)
