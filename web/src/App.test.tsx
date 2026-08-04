import { render, screen } from '@testing-library/react'
import App from './App'

describe('App 佔位畫面', () => {
  it('渲染品牌名稱與載入提示', () => {
    render(<App />)
    expect(screen.getByTestId('app-root')).toBeInTheDocument()
    expect(screen.getByText('銀髮一句通')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('載入中')
  })
})
