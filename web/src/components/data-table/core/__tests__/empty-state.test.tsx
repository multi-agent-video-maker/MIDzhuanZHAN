import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { DataTableView } from '../data-table-view'

function EmptyTable(props: { custom?: boolean }) {
  const table = useReactTable<{ name: string }>({
    data: [],
    columns: [{ accessorKey: 'name', header: 'Name' }],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <DataTableView
      table={table}
      emptyTitle='No API Keys Found'
      emptyContent={props.custom ? 'No API Keys Found' : undefined}
    />
  )
}

it.each([false, true])(
  'renders an empty table row without an entrance animation or hover fill (custom content: %s)',
  (custom) => {
    render(<EmptyTable custom={custom} />)
    const row = screen.getByRole('row', { name: /No API Keys Found/ })
    expect(row).toBeVisible()
    expect(row).toHaveClass('animate-none', 'transition-none')
    expect(row.className).not.toContain('hover:')
  }
)
