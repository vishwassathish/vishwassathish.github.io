import { useState } from 'react';
// import "./Publications.css"
import data from './data_publications.json'
export const Publications = () => {
    console.log(data)
    const [patent_data, setPatentData] = useState(data)
    return <>
        <div style={{ textAlign: 'justify' }}>
            <div style={{ width: '100%', maxWidth: '800px', border: '0px', borderSpacing: '0px', borderCollapse: 'separate', marginRight: 'auto', marginLeft: 'auto' }}>
                <h2>Academic Publications</h2>
                <br/>
                <table style={{
                    width: '100%', border: '0px', borderSpacing: '0px', borderCollapse: 'separate', marginRight: 'auto', marginLeft: 'auto'
                }} >
                    <tbody>

                        {
                            patent_data && patent_data.length > 0 && patent_data.map((row, index) => (
                                <tr >
                                    <td style={{ padding: '10px', width: '18%', verticalAlign: 'middle' }}>
                                        <div className="one">
                                            <img src={process.env.PUBLIC_URL+row.img} width="160" />
                                        </div>

                                    </td>

                                    <td style={{ paddingLeft: '20px',paddingRight: '20px', width: '75%', verticalAlign: 'top' }}>
                                        <a href={row.link}>
                                            <span className="papertitle">{row.title}</span>
                                        </a>
                                        <div dangerouslySetInnerHTML={{ __html: row.authors }} ></div>
                                        {row.other_links && <div dangerouslySetInnerHTML={{ __html: row.other_links }}></div>}
                                        <div dangerouslySetInnerHTML={{ __html: row.publication }} ></div>
                                        {row.presented && <div dangerouslySetInnerHTML={{ __html: row.presented }} ></div>}
                                        <br />
                                    </td>
                                </tr>
                            ))
                        }
                    </tbody>
                </table>
            </div>
        </div >
    </>
}

export default Publications;