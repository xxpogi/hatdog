'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Plus, Users } from 'lucide-react'

interface Team {
  id: string
  name: string
  slug: string
  role: string
  avatarUrl?: string | null
}

interface TeamSelectorProps {
  teams: Team[]
  currentTeam: Team
}

export function TeamSelector({ teams, currentTeam }: TeamSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          {currentTeam.avatarUrl ? (
            <img
              src={currentTeam.avatarUrl}
              alt={currentTeam.name}
              className="w-full h-full rounded-lg object-cover"
            />
          ) : (
            <span className="text-sm font-medium text-primary">
              {currentTeam.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="text-left hidden sm:block">
          <p className="text-sm font-medium">{currentTeam.name}</p>
          <p className="text-xs text-muted-foreground capitalize">{currentTeam.role.toLowerCase()}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Your Teams
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {teams.map((team) => (
                  <Link
                    key={team.id}
                    href={`/teams/${team.slug}`}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors ${
                      team.id === currentTeam.id ? 'bg-primary/5' : ''
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      {team.avatarUrl ? (
                        <img
                          src={team.avatarUrl}
                          alt={team.name}
                          className="w-full h-full rounded-lg object-cover"
                        />
                      ) : (
                        <span className="text-sm font-medium text-primary">
                          {team.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{team.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{team.role.toLowerCase()}</p>
                    </div>
                    {team.id === currentTeam.id && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </Link>
                ))}
              </div>
              <div className="p-2 border-t border-border">
                <Link
                  href="/teams/new"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create New Team
                </Link>
                <Link
                  href="/teams"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Manage Teams
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
