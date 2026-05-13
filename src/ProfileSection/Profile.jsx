import { useState } from 'react';
import "./Profile.css"
export const Profile = () => {
    return <>
        <div style={{ textAlign: 'justify' }}>
            <div style={{ width: '100%', maxWidth: '800px', border: '0px', borderSpacing: '0px', borderCollapse: 'separate', marginRight: 'auto', marginLeft: 'auto' }}>
                <table
                    style={{ width: '100%', border: '0px', borderSpacing: '0px', borderCollapse: 'separate', marginRight: 'auto', marginLeft: 'auto' }}>
                    <tbody>
                        <tr style={{ padding: '0px' }}>
                            <td style={{ padding: '2.5%', width: '63%', verticalAlign: 'middle' }}>
                                <p className='name' style={{ textAlign: 'center' }}>
                                    Vishwas Sathish
                                    <p className="sub_name" style={{ textAlign: "center" }}>
                                        <b>Email</b> : vsathish@cs.washington.edu
                                    </p>
                                </p>

                                <p style={{ textAlign: 'justify' }}>
                                    I am a CS PhD student at University of Washington, advised by <a
                                        href="https://www.rajeshpnrao.com/">Prof. Rajesh Rao</a>.
                                    My research interests lie in Unsupervised Representation Learning, Model Based Reinforcement Learning, Computational
                                    Neuroscience and their applications to Vision, Robotics and other domains. More recently, I have been working on 
                                    formulating the principles of compositional learning required to solve complex real world problems.
                                </p>
                                <p style={{ textAlign: 'justify' }}>
                                    I am also interested in building models for general purpose
                                    perception, policy learning and planning using these principles. While modern LLMs like GPTs and Dall-E 
                                    exhibit approximate compositional structures from data, they lack the explicit capability to solve symbol 
                                    manipulation problems such as spatial reasoning and mathematical deductions. I aim to teach LLMs to do that.
                                </p>
                                <p style={{ textAlign: "justify" }}>
                                    Before starting my research, I enjoyed two years working as a Machine Learning Engineer at <a href='www.7sugar.com'>7sugar</a>, a
                                    small healthcare startup in Bangalore. I have also interned at Morgan Stanley in the past.
                                </p>
                                <p style={{ textAlign: "center" }}>
                                    <a href={process.env.PUBLIC_URL + "data/vish_data/Vishwas_Academic_Resume.pdf"}>CV</a> &nbsp;|&nbsp;

                                    <a href="https://scholar.google.com/citations?user=Ad01nlUAAAAJ&hl=en">Google Scholar</a>
                                    &nbsp;|&nbsp;
                                    <a href="https://twitter.com/sathish_vishwas">Twitter</a> &nbsp;|&nbsp;
                                    <a href="https://github.com/vishwassathish">Github</a> &nbsp;|&nbsp;
                                    <a href="https://neural.cs.washington.edu/">Neural Systems Lab</a>
                                </p>
                                {/* <p style={{ textAlign: "center" }}>
                                    <a href={process.env.PUBLIC_URL + "data/vish_data/Vishwas_Research_Statement.pdf"}>Research Statement</a>
                                    &nbsp;|&nbsp;
                                    <a href={process.env.PUBLIC_URL + "data/vish_data/Vishwas_Teaching_Statement.pdf"}> Teaching Statement</a> &nbsp;|&nbsp;
                                    <a href={process.env.PUBLIC_URL + "data/vish_data/Vishwas_Diversity_Statement.pdf"}>Diversity Statement</a>
                                </p> */}
                            </td>
                            <td style={{ padding: '2.5%', width: '40%', maxWidth: '40%' }}>
                                <a href={process.env.PUBLIC_URL + "images/vish_images/profile_2.png"}><img style={{ width: '100%', maxWidth: '100%', borderRadius: '50%' }}
                                    alt="profile photo" src={process.env.PUBLIC_URL + "images/vish_images/profile_2.png"} className="hoverZoomLink" /></a>
                            </td>
                        </tr>
                    </tbody >
                </table >
            </div>
        </div >
    </>
}

export default Profile;