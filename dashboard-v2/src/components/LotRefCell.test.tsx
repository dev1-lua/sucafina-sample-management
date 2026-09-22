import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { LotRefCell, OrderLinkCell } from './LotRefCell';

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe('LotRefCell', () => {
  it('renders the bare ref when the coffee has been sent once', () => {
    render(wrap(<LotRefCell row={{ ref: 'SL-7336', lot_sends: 1 }} basePath="/samples" />));
    expect(screen.getByText('SL-7336')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('adds a ×N pill linking to the Coffees view with that ref expanded, without triggering the row click', () => {
    const onRow = vi.fn();
    render(
      wrap(
        <div onClick={onRow}>
          <LotRefCell row={{ sample_ref: 'TYPE-113', lot_sends: 3 }} basePath="/bulk" />
        </div>,
      ),
    );
    const pill = screen.getByRole('link', { name: '3 sends of this coffee' });
    expect(pill).toHaveTextContent('×3');
    expect(pill).toHaveAttribute('title', '3 sends of this coffee');
    expect(pill).toHaveAttribute('href', '/bulk?view=coffees&ref=TYPE-113');
    fireEvent.click(pill);
    expect(onRow).not.toHaveBeenCalled();
  });
});

describe('OrderLinkCell', () => {
  it('links the order number to its consignment page; em-dash when the send is not in an order', () => {
    const onRow = vi.fn();
    const { rerender } = render(
      wrap(
        <div onClick={onRow}>
          <OrderLinkCell row={{ consignment_number: 'CN-1012', consignment_id: 'c-1' }} />
        </div>,
      ),
    );
    const link = screen.getByRole('link', { name: 'CN-1012' });
    expect(link).toHaveAttribute('href', '/consignments/c-1');
    fireEvent.click(link);
    expect(onRow).not.toHaveBeenCalled();
    rerender(wrap(<OrderLinkCell row={{ consignment_number: null, consignment_id: null }} />));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
